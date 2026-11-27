import assert from "node:assert/strict";
import { test } from "node:test";
import { countsLine, kindOf, OUTCOME, rateLine, type CheckResult } from "./outcome.ts";

const held = (key: string): CheckResult => ({ key, name: key, passed: true, errored: false });
const missed = (key: string | undefined, name = key ?? "check"): CheckResult => ({ key, name, passed: false, errored: false });
const logged = (outcome: object) => [`shopper: hello`, OUTCOME + JSON.stringify(outcome)];

test("a run whose every check held passed", () => {
  assert.equal(kindOf({ verdict: "passed", assertions: [held("product-in-cart")], logs: logged({}) }), "passed");
  assert.equal(kindOf({ verdict: "passed", assertions: [held("has-cards")] }), "passed");
});

test("a store's own answer is its own kind, neither a pass nor a failure", () => {
  const logs = logged({ store_answer: { what: "out of stock", read_from: "the reply's words", said: "it is out of stock" } });
  assert.equal(kindOf({ verdict: "passed", assertions: [held("nothing-ordered")], logs }), "store's own answer");
});

test("a failed check about Agentcard is a failure, whatever else the run saw", () => {
  const logs = logged({ store_answer: { what: "no seats or availability", read_from: "the answer's fields", said: "none" }, app_mistakes: [{ said: "yes", reply: "no update" }] });
  assert.equal(kindOf({ verdict: "failed", assertions: [missed("cards-inside-the-dates"), missed("app-called-the-buy-tool")], logs }), "failed");
});

test("a run where only the example chat app got it wrong is counted apart", () => {
  const logs = logged({ app_mistakes: [{ said: "any update?", reply: "nothing yet" }] });
  assert.equal(kindOf({ verdict: "failed", assertions: [held("product-in-cart"), missed("app-called-the-buy-tool")], logs }), "example app's mistake");
  assert.equal(kindOf({ verdict: "failed", assertions: [missed("agent-reply-true")] }), "example app's mistake");
});

test("a connection that dropped twice is the run's own failure", () => {
  const logs = logged({ broke: "the connection dropped on the first message, and again in a fresh chat" });
  assert.equal(kindOf({ verdict: "failed", assertions: [missed("chat-stayed-connected"), missed(undefined, "succeeded")], logs }), "run broke");
  // The same checks without a dropped connection on record are a failure.
  assert.equal(kindOf({ verdict: "failed", assertions: [missed(undefined, "succeeded")] }), "failed");
});

test("a run that timed out, with no failed check, is a failure", () => {
  assert.equal(kindOf({ verdict: "failed", error: "Eval timed out", assertions: [held("agent-replies")] }), "failed");
});

test("a skipped eval is skipped", () => {
  assert.equal(kindOf({ verdict: "skipped", assertions: [] }), "skipped");
});

test("three runs of one eval read as one line", () => {
  assert.equal(rateLine(["passed", "passed", "failed"]), "Passed 2 of 3 runs. 1 failed.");
  assert.equal(rateLine(["passed", "store's own answer", "failed"]), "Passed 1 of 3 runs. 1 failed, 1 got the store's own answer.");
  assert.equal(rateLine(["passed", "passed", "passed"]), "Passed 3 of 3 runs.");
  assert.equal(rateLine(["failed"]), "This run failed.");
  assert.equal(rateLine(["skipped", "skipped"]), "Skipped.");
});

test("a run's counts name only the kinds that happened", () => {
  assert.equal(countsLine(["passed", "passed", "failed", "store's own answer"]), "4 runs: 2 passed, 1 failed, 1 store's own answer");
});
