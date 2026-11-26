import assert from "node:assert/strict";
import { test } from "node:test";
import { rowsToRun, DRAFT, REJECTED, REVIEWED, type RealAsk } from "../evals/lib/real-asks.ts";
import { firstSentences, removedWords, reviewText, slackTarget } from "./review-post.ts";

// Every message here is made up.
test("the review post is three lines: the shopper, the agent, and the two emoji", () => {
  assert.equal(reviewText(["a yoga mat under $30"], "I couldn't find a yoga mat under $30. Want me to look at other stores?"), "🛒 *Shopper:* a yoga mat under $30\n🤖 *Agent:* I couldn't find a yoga mat under $30. Want me to look at other stores?\n👍 / 👎");
});

test("the post stays three short lines whatever the text holds", () => {
  const text = reviewText(["running shoes", "size 10,\nin <blue> & black"], "x".repeat(900));
  const lines = text.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "🛒 *Shopper:* running shoes → size 10, in &lt;blue&gt; &amp; black");
  assert.ok(lines[1]!.length < 260 && lines[1]!.endsWith("…"));
  assert.equal(reviewText(["a kettle"], " ").split("\n")[1], "🤖 *Agent:* (no reply)");
  assert.ok(reviewText(["y".repeat(900)], "ok").split("\n")[0]!.length < 300);
});

test("keeps the first sentence or two of a reply", () => {
  assert.equal(firstSentences("No kettle was found at Target. Want me to try Walmart? I can also widen the price."), "No kettle was found at Target. Want me to try Walmart?");
  assert.equal(firstSentences("One long line with no full stop"), "One long line with no full stop");
  assert.ok(firstSentences(`${"word ".repeat(100)}. Next.`).length <= 240);
});

test("finds the words the cleaning took out of the shopper's message", () => {
  assert.deepEqual(removedWords(["a gift card for Jordana Pemberly"], ["a gift card for Alex"]), ["jordana", "pemberly"]);
  assert.deepEqual(removedWords(["a yoga mat"], ["a yoga mat"]), []);
});

test("posts only when both Slack settings are there", () => {
  assert.equal(slackTarget({}), null);
  assert.equal(slackTarget({ SLACK_BOT_TOKEN: "t" }), null);
  assert.deepEqual(slackTarget({ SLACK_BOT_TOKEN: "t", SLACK_EVALS_CHANNEL: "C1" }), { token: "t", channel: "C1" });
});

test("runs only the rows named, whatever their review, but never a rejected one", () => {
  const row = (id: string, review: string): RealAsk => ({ id, messages: ["a yoga mat"], wants: [{ what: "yoga mat", must: ["a yoga mat"] }], mayAsk: false, priced: true, pickedFor: [], day: "2026-01-01", kind: "retail", review });
  const rows = [row("a", DRAFT), row("b", REVIEWED), row("c", REJECTED)];
  assert.deepEqual(rowsToRun(rows, 30, false, ["a"]).map((made) => made.id), ["a"]);
  assert.deepEqual(rowsToRun(rows, 30, false, ["c", "nope"]), []);
});
