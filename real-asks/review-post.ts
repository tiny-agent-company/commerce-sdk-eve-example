import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";
import { scrub, stillHolds, words } from "./scrub.ts";

/**
 * The Slack post that asks a person to review one saved row, in the same layout as a failed eval:
 * - the post is the message sent to the agent, word for word after cleaning, then the two emoji to answer with;
 * - its thread holds any later message, then the agent's reply, then why the answer was picked as a failure.
 * A thumbs up on the post makes the row an eval and starts a fix; a thumbs down drops the row. A listener outside this
 * repository reads the emoji on the post (the README says where it runs).
 *
 * Only cleaned text is ever posted: the row's own cleaned messages, and a reply cleaned by `shortReply` below.
 */

const MOST_ASK = 3000;
const MOST_REPLY = 3000;
/** How long a sentence-or-two cut is, for the judge's note that stands in for a reply on rows saved before replies were kept. */
const MOST_SENTENCES = 240;

/** The first sentence or two of a text, up to `most` characters. */
export function firstSentences(text: string, most = MOST_SENTENCES): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [flat];
  let kept = sentences[0]?.trim() ?? "";
  if (sentences[1] && `${kept} ${sentences[1].trim()}`.length <= most) kept = `${kept} ${sentences[1].trim()}`;
  return kept.length > most ? `${kept.slice(0, most - 1).trimEnd()}…` : kept;
}

/** Slack reads `&`, `<` and `>` as markup, so they are escaped; every line of the text is quoted under a short label. */
function quoted(label: string, text: string, most: number): string {
  const trimmed = text.trim();
  const cut = trimmed.length > most ? `${trimmed.slice(0, most - 1).trimEnd()}…` : trimmed;
  const safe = cut.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `*${label}*\n${safe.split("\n").map((one) => `>${one}`).join("\n")}`;
}

/** Why a row was picked, as sentences a reader can follow, one per line. */
const PICKED: Record<string, string> = {
  "nothing found": "The search found nothing.",
  refused: "Agentcard refused the ask.",
  "no answer": "The agent gave no answer.",
  rephrased: "The shopper asked again in other words right after the answer.",
  "said it was wrong": "The shopper said the answer was wrong.",
  "the judge failed the answer": "The judge found the answer wrong.",
};

/** A review post and its thread: the first message as the post, then each later message, the reply and why it failed. */
export interface ReviewLayout {
  post: string;
  thread: string[];
}

/**
 * The review's layout. `messages` are the row's cleaned messages, `reply` the cleaned answer (empty when there was
 * none), `pickedFor` the reasons the row was picked and `judgeNote` the judge's reason, when it gave one.
 */
export function reviewLayout(messages: string[], reply: string, pickedFor: string[] = [], judgeNote = ""): ReviewLayout {
  const [first = "", ...later] = messages;
  const reasons = pickedFor.map((why) => (why === "the judge failed the answer" && judgeNote.trim() ? `${PICKED[why]} ${judgeNote.trim()}` : (PICKED[why] ?? why)));
  const safe = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    post: `${quoted("Message sent to the agent:", first, MOST_ASK)}\n👍 / 👎`,
    thread: [
      ...later.map((message) => quoted("Message sent to the agent:", message, MOST_ASK)),
      quoted("Agent's reply:", reply.trim() ? reply : "(no reply)", MOST_REPLY),
      ...(reasons.length ? [`*Why the eval failed:*\n${reasons.map((why) => `• ${safe(why)}`).join("\n")}`] : []),
    ],
  };
}

/** Posts one review message and returns its timestamp, which with the channel names the message for good. Null when Slack refused it. */
export async function postReview(token: string, channel: string, text: string, thread?: string): Promise<string | null> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false, ...(thread ? { thread_ts: thread } : {}) }),
  });
  const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (!answer.ok) console.error(`Slack did not take a review post: ${answer.error}`);
  return answer.ok ? (answer.ts ?? null) : null;
}

/** Where review posts go: the same bot and channel the failed evals are posted with. Null when either is not set. */
export function slackTarget(env: NodeJS.ProcessEnv = process.env): { token: string; channel: string } | null {
  return env.SLACK_BOT_TOKEN && env.SLACK_EVALS_CHANNEL ? { token: env.SLACK_BOT_TOKEN, channel: env.SLACK_EVALS_CHANNEL } : null;
}

const Short = z.object({ text: z.string().describe("The whole reply, copied word for word, with personal details replaced.") });

const RULES = [
  "You are given the reply a shopping assistant sent to a shopper. Copy all of it, word for word, line breaks included, and replace personal details in it.",
  "A person's name becomes `Alex` (a second person `Sam`). A street address becomes `123 Main St`. An email, a phone number, a username, an order or account id becomes `[removed]`.",
  "Keep brand names, store names, product names, prices, cities and the names of public places. Change nothing else, add nothing, and do not summarise.",
].join("\n");

/**
 * The reply as it is posted for review: all of it, word for word, with personal details removed by the fixed
 * patterns, then by a model for what a pattern cannot know (a name), then by the patterns again. `removed` are the
 * words the cleaning of the shopper's own message took out, such as a name: a reply that repeats one loses it too.
 * Returns an empty text when the reply is empty, and a note in brackets when it could not be cleaned safely.
 */
export async function shortReply(reply: string, removed: string[] = []): Promise<string> {
  const typed = scrub(reply).slice(0, 2000);
  if (!typed.trim()) return "";
  try {
    const { output } = await generateText({ model: anthropic("claude-opus-5-5"), output: Output.object({ schema: Short }), system: RULES, prompt: typed });
    let text = scrub(output.text).trim();
    for (const word of removed) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), "[removed]");
    // A text with words the reply never had was rewritten, not copied: it is not the answer the shopper got.
    const known = new Set([...words(typed), "alex", "sam", "removed", "123", "main", "st"]);
    const said = words(text);
    if (said.length === 0 || stillHolds(text) || said.filter((word) => !known.has(word)).length / said.length > 0.1) return "(the reply could not be cleaned, so it is not shown)";
    return text;
  } catch {
    return "(the reply could not be cleaned, so it is not shown)";
  }
}

/** The words of the shopper's messages as typed that the cleaned messages no longer hold: what the cleaning removed. */
export function removedWords(typed: string[], cleaned: string[]): string[] {
  const kept = new Set(words(cleaned.join(" ")));
  return [...new Set(words(typed.join(" ")).filter((word) => word.length >= 3 && !kept.has(word)))];
}

/** The part of a Braintrust dataset the posting uses. */
export interface Updatable {
  update(row: { id: string; metadata: Record<string, unknown> }): string;
  flush(): Promise<void>;
}

/**
 * Posts one message for each row, with its thread, and keeps the message's channel and timestamp on the row, under
 * `metadata.slack`, so an emoji on the message can be tied back to the row. A row is saved as soon as its message is posted, so a run that
 * stops part way never posts the same row twice. Returns the rows posted, with each message's timestamp.
 */
export async function postRows(dataset: Updatable, rows: { id: string; messages: string[]; reply: string; pickedFor?: string[]; judgeNote?: string }[], target: { token: string; channel: string }): Promise<{ id: string; ts: string }[]> {
  const posted: { id: string; ts: string }[] = [];
  for (const row of rows) {
    const layout = reviewLayout(row.messages, row.reply, row.pickedFor, row.judgeNote);
    const ts = await postReview(target.token, target.channel, layout.post);
    if (!ts) continue;
    for (const reply of layout.thread) {
      await new Promise((done) => setTimeout(done, 1200));
      await postReview(target.token, target.channel, reply, ts);
    }
    dataset.update({ id: row.id, metadata: { slack: { channel: target.channel, ts } } });
    await dataset.flush();
    posted.push({ id: row.id, ts });
    // Slack takes about one message a second in a channel.
    await new Promise((done) => setTimeout(done, 1200));
  }
  return posted;
}
