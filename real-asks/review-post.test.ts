import assert from "node:assert/strict";
import { test } from "node:test";
import { rowsToRun, DRAFT, REJECTED, REVIEWED, type RealAsk } from "../evals/lib/real-asks.ts";
import { firstSentences, removedWords, reviewLayout, slackTarget } from "./review-post.ts";

// Every message here is made up.
test("the review post is the message sent to the agent and the two emoji; the reply and why it failed go in its thread", () => {
  const layout = reviewLayout(["a yoga mat under $30"], "I couldn't find a yoga mat under $30.\nWant me to look at other stores?", ["nothing found", "the judge failed the answer"], "No card is a yoga mat.");
  assert.equal(layout.post, "*Message sent to the agent:*\n>a yoga mat under $30\n👍 / 👎");
  assert.deepEqual(layout.thread, [
    "*Agent's reply:*\n>I couldn't find a yoga mat under $30.\n>Want me to look at other stores?",
    "*Why the eval failed:*\n• The search found nothing.\n• The judge found the answer wrong. No card is a yoga mat.",
  ]);
});

test("a later message goes in the thread before the reply, and markup is escaped", () => {
  const layout = reviewLayout(["running shoes", "size 10, in <blue> & black"], " ");
  assert.equal(layout.post, "*Message sent to the agent:*\n>running shoes\n👍 / 👎");
  assert.deepEqual(layout.thread, ["*Message sent to the agent:*\n>size 10, in &lt;blue&gt; &amp; black", "*Agent's reply:*\n>(no reply)"]);
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
