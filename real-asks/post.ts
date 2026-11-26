/**
 * Posts saved rows that nobody has been asked about yet to Slack for review: every row of the dataset that is still a
 * draft and has no Slack message. The daily job posts its own rows as it saves them; this command is for rows saved
 * before that, or for a day when Slack could not be reached.
 *
 *   node real-asks/post.ts --limit 3     # the three newest
 *   node real-asks/post.ts               # every row not posted yet
 *   node real-asks/post.ts --dry-run     # how many it would post, posting nothing
 *
 * It prints row ids and message timestamps only, never a shopper's words.
 */
import { DATASET, DRAFT, PROJECT, REJECTED, REVIEWED } from "../evals/lib/real-asks.ts";
import { firstSentences, postRows, slackTarget, type Updatable } from "./review-post.ts";

interface Row {
  id: string;
  input?: { messages?: unknown };
  metadata?: { review?: unknown; day?: unknown; slack?: { ts?: unknown }; seen?: { reply?: unknown; judge_note?: unknown } };
}

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const dry = args.includes("--dry-run");
const target = slackTarget();

if (!process.env.BRAINTRUST_API_KEY) {
  console.error("real-asks post failed: BRAINTRUST_API_KEY is not set, so the rows cannot be read");
  process.exit(2);
}
if (!target && !dry) {
  console.error("real-asks post failed: set SLACK_BOT_TOKEN and SLACK_EVALS_CHANNEL (--dry-run needs neither)");
  process.exit(2);
}

const dataset = (await import("braintrust")).initDataset({ project: PROJECT, dataset: DATASET });
const waiting: { id: string; day: string; messages: string[]; reply: string }[] = [];
for await (const row of dataset as unknown as AsyncIterable<Row>) {
  const review = String(row.metadata?.review ?? DRAFT).trim().toLowerCase();
  if (review === REVIEWED || review === REJECTED || row.metadata?.slack?.ts) continue;
  const messages = Array.isArray(row.input?.messages) ? row.input.messages.filter((message): message is string => typeof message === "string" && message.trim().length > 0) : [];
  if (messages.length === 0) continue;
  const seen = row.metadata?.seen ?? {};
  // A row saved before replies were kept has no reply; it shows the judge's one-line account of the reply in its place.
  const reply = typeof seen.reply === "string" ? seen.reply : typeof seen.judge_note === "string" && seen.judge_note ? firstSentences(seen.judge_note) : "(the reply was not kept for this row)";
  waiting.push({ id: row.id, day: typeof row.metadata?.day === "string" ? row.metadata.day : "", messages, reply });
}
waiting.sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
const rows = waiting.slice(0, Number.isFinite(limit) && limit >= 0 ? limit : waiting.length);

if (dry || !target) {
  console.log(`real-asks post ok: dry run, would post ${rows.length} of ${waiting.length} rows not posted yet`);
} else {
  const posted = await postRows(dataset as unknown as Updatable, rows, target);
  for (const row of posted) console.log(`posted ${row.id} as message ${row.ts}`);
  console.log(`real-asks post ok: posted ${posted.length} of ${waiting.length} rows not posted yet`);
  if (posted.length < rows.length) process.exitCode = 1;
}
