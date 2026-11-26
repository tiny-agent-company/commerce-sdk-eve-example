import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";
import { scrub, stillHolds, words } from "./scrub.ts";

/**
 * The Slack post that asks a person to review one saved row: three lines, the shopper's cleaned message, the answer
 * they got, and the two emoji to answer with. A thumbs up on the post makes the row an eval and starts a fix; a thumbs
 * down drops the row. A listener outside this repository reads the emoji (the README says where it runs).
 *
 * Only cleaned text is ever posted: the row's own cleaned messages, and a reply cleaned by `shortReply` below.
 */

const MOST_ASK = 280;
const MOST_REPLY = 240;

/** Slack reads `&`, `<` and `>` as markup, so they are escaped; the text is put on one line and cut to `most`. */
function line(text: string, most: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat;
  return cut.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The first sentence or two of a text, up to `most` characters. */
export function firstSentences(text: string, most = MOST_REPLY): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [flat];
  let kept = sentences[0]?.trim() ?? "";
  if (sentences[1] && `${kept} ${sentences[1].trim()}`.length <= most) kept = `${kept} ${sentences[1].trim()}`;
  return kept.length > most ? `${kept.slice(0, most - 1).trimEnd()}…` : kept;
}

/** The post's text. `messages` are the row's cleaned messages; `reply` is the cleaned answer, or empty when there was none. */
export function reviewText(messages: string[], reply: string): string {
  const ask = messages.length > 1 ? messages.join(" → ") : (messages[0] ?? "");
  return [`🛒 *Shopper:* ${line(ask, MOST_ASK)}`, `🤖 *Agent:* ${reply.trim() ? line(reply, MOST_REPLY) : "(no reply)"}`, "👍 / 👎"].join("\n");
}

/** Posts one review message and returns its timestamp, which with the channel names the message for good. Null when Slack refused it. */
export async function postReview(token: string, channel: string, text: string): Promise<string | null> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (!answer.ok) console.error(`Slack did not take a review post: ${answer.error}`);
  return answer.ok ? (answer.ts ?? null) : null;
}

/** Where review posts go: the same bot and channel the failed evals are posted with. Null when either is not set. */
export function slackTarget(env: NodeJS.ProcessEnv = process.env): { token: string; channel: string } | null {
  return env.SLACK_BOT_TOKEN && env.SLACK_EVALS_CHANNEL ? { token: env.SLACK_BOT_TOKEN, channel: env.SLACK_EVALS_CHANNEL } : null;
}

const Short = z.object({ text: z.string().describe("The first one or two sentences of the reply, copied word for word, with personal details replaced.") });

const RULES = [
  "You are given the reply a shopping assistant sent to a shopper. Copy its first one or two sentences, word for word, and replace personal details in them.",
  "A person's name becomes `Alex` (a second person `Sam`). A street address becomes `123 Main St`. An email, a phone number, a username, an order or account id becomes `[removed]`.",
  "Keep brand names, store names, product names, prices, cities and the names of public places. Change nothing else, add nothing, and do not summarise.",
].join("\n");

/**
 * The reply as it is posted for review: its first sentence or two, with personal details removed by the fixed
 * patterns, then by a model for what a pattern cannot know (a name), then by the patterns again. `removed` are the
 * words the cleaning of the shopper's own message took out, such as a name: a reply that repeats one loses it too.
 * Returns an empty text when the reply is empty, and a note in brackets when it could not be cleaned safely.
 */
export async function shortReply(reply: string, removed: string[] = []): Promise<string> {
  const typed = scrub(reply).slice(0, 2000);
  if (!typed.trim()) return "";
  try {
    const { output } = await generateText({ model: anthropic("claude-opus-5-5"), output: Output.object({ schema: Short }), system: RULES, prompt: typed });
    let text = firstSentences(scrub(output.text));
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
 * Posts one message for each row and keeps the message's channel and timestamp on the row, under `metadata.slack`, so
 * an emoji on the message can be tied back to the row. A row is saved as soon as its message is posted, so a run that
 * stops part way never posts the same row twice. Returns the rows posted, with each message's timestamp.
 */
export async function postRows(dataset: Updatable, rows: { id: string; messages: string[]; reply: string }[], target: { token: string; channel: string }): Promise<{ id: string; ts: string }[]> {
  const posted: { id: string; ts: string }[] = [];
  for (const row of rows) {
    const ts = await postReview(target.token, target.channel, reviewText(row.messages, row.reply));
    if (!ts) continue;
    dataset.update({ id: row.id, metadata: { slack: { channel: target.channel, ts } } });
    await dataset.flush();
    posted.push({ id: row.id, ts });
    // Slack takes about one message a second in a channel.
    await new Promise((done) => setTimeout(done, 1200));
  }
  return posted;
}
