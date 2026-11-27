import assert from "node:assert/strict";
import { test } from "node:test";
import { shownRun, summaryText, whyText, type Eval, type Run } from "./slack-reporter.ts";

const run = (attempt: number, kind: Run["kind"], reasons: string[] = [], outcome: Run["outcome"] = {}): Run => ({ attempt, kind, outcome, messages: [], reasons });
const out = { store_answer: { what: "out of stock" as const, read_from: "the reply's words" as const, said: "The store says the hammer is out of stock." } };

test("an eval that ran three times gets one post, which shows a run that failed", () => {
  const runs = [run(1, "passed"), run(2, "failed", ["This did not hold: The cart's line shows a price."]), run(3, "failed", ["This did not hold: The cart's line shows a price."])];
  assert.equal(shownRun(runs)?.attempt, 2);
  const text = whyText({ id: "buy/checkout/0011", name: "checkout: B&H", runs }, runs[1]!);
  assert.match(text, /^\*Why the eval failed:\*/);
  assert.match(text, /Passed 1 of 3 runs\. 2 failed\. This thread shows run 2\./);
  assert.match(text, /Run 3 ended the same way\./);
  // The reason three runs share is said once.
  assert.equal(text.split("The cart's line shows a price").length - 1, 1);
});

test("a run that failed another way is told beside the one the thread shows", () => {
  const runs = [run(1, "failed", ["Reason one."]), run(2, "failed", ["Reason two."]), run(3, "store's own answer", [], out)];
  const text = whyText({ id: "x", name: "x", runs }, runs[0]!);
  assert.match(text, /Passed 0 of 3 runs\. 2 failed, 1 got the store's own answer\./);
  assert.match(text, /\*Run 2 failed differently:\*\n• Reason two\./);
  assert.match(text, /Run 3 got the store's own answer, which is not a failure: out of stock\./);
});

test("an eval that ran once reads as before", () => {
  const runs = [run(1, "failed", ["Reason one."])];
  assert.equal(whyText({ id: "x", name: "x", runs }, runs[0]!), "*Why the eval failed:*\n• Reason one.");
});

test("a store's own answer gets no post of its own, and is listed in the run's closing message", () => {
  const evals: Eval[] = [
    { id: "buy/checkout/0006", name: "checkout: Lowe's, through the retail ordering supplier", runs: [run(1, "passed"), run(2, "store's own answer", [], out), run(3, "passed")] },
    { id: "buy/cart/0001", name: "cart: Walmart", runs: [run(1, "passed"), run(2, "passed"), run(3, "example app's mistake", ["x"], { app_mistakes: [{ said: "1 Ferry Building", reply: "I still need the name." }] })] },
    { id: "buy/cart/0002", name: "cart: Target", runs: [run(1, "failed", ["x"]), run(2, "failed", ["x"]), run(3, "failed", ["x"])] },
  ];
  assert.equal(shownRun(evals[0]!.runs), null);
  const text = summaryText(evals)!;
  assert.match(text, /3 evals, each run 3 times\. 9 runs: 4 passed, 3 failed, 1 store's own answer, 1 example app's mistake\./);
  assert.match(text, /checkout: Lowe's, through the retail ordering supplier: out of stock, in 1 of 3 runs/);
  assert.match(text, /cart: Walmart, in 1 of 3 runs: after "1 Ferry Building" it said: I still need the name\./);
  assert.match(text, /\*Passed only some of the time:\*\n• checkout: Lowe's/);
  assert.match(text, /\*Failed every time:\*\n• cart: Target/);
});

test("a run with nothing to add to the evals' own posts has no closing message", () => {
  assert.equal(summaryText([{ id: "a", name: "a", runs: [run(1, "passed")] }]), null);
  assert.equal(summaryText([{ id: "a", name: "a", runs: [run(1, "passed")] }, { id: "b", name: "b", runs: [run(1, "failed", ["x"])] }]), null);
  assert.notEqual(summaryText([{ id: "a", name: "a", runs: [run(1, "store's own answer", [], out)] }]), null);
});
