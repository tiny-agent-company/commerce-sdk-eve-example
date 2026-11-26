/**
 * The daily job: reads one day of real buy conversations, keeps the shopper messages that did not get a good answer,
 * removes personal details and saves each as a draft row of the private Braintrust dataset the `real` evals run from.
 *
 *   node real-asks/pick.ts                 # yesterday (UTC)
 *   node real-asks/pick.ts --day 2026-11-24
 *   node real-asks/pick.ts --dry-run       # everything but the save
 *
 * Each saved row is also posted to Slack for review, when SLACK_BOT_TOKEN and SLACK_EVALS_CHANNEL are set (review-post.ts).
 *
 * Everything it needs comes from environment variables (the README lists them); it reads no settings file.
 *
 * It prints numbers only. A shopper's words are never printed, logged or written to a file: they go from the database
 * to the model that cleans them, and only the cleaned text goes on, to Braintrust and to the review post in Slack.
 *
 * It ends with one line that starts `real-asks ok:` and exit code 0, or one line that starts `real-asks failed:` and
 * exit code 1 (the run broke part way) or 2 (a setting is missing, nothing was read).
 */
import { createHash } from "node:crypto";
import { judge } from "../evals/lib/judge.ts";
import { DATASET, DRAFT, PROJECT } from "../evals/lib/real-asks.ts";
import { cardsOf } from "./cards.ts";
import { isOwnEvalAsk, ownEvalAsks } from "./own-evals.ts";
import { prepare, type Case } from "./prepare.ts";
import { readDay, source } from "./read.ts";
import { postRows, removedWords, shortReply, slackTarget, type Updatable } from "./review-post.ts";
import { alike, scrub } from "./scrub.ts";
import { picks, signsOf, turnsOf, typedAsk, type Sign, type Turn } from "./signals.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const number = (name: string, fallback: number) => (Number.isFinite(Number(process.env[name])) && process.env[name] ? Number(process.env[name]) : fallback);

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const add = (counts: Record<string, number>, key: string) => void (counts[key] = (counts[key] ?? 0) + 1);

/** The numbers of the run so far, for the last line: what a person or an alarm reads when the job ends. */
const run = { day: "", step: "starting", conversations: 0, read: 0, asks: 0, prepared: 0, picked: 0, saved: 0, rows: 0, posted: 0 };
const line = () => `day=${run.day} conversations=${run.conversations} read=${run.read} asks=${run.asks} prepared=${run.prepared} picked=${run.picked} saved=${run.saved} rows_in_dataset=${run.rows} posted_for_review=${run.posted}`;

/** A setting is missing: nothing was read and nothing was saved. */
class Missing extends Error {}

/** Runs `work` over `items`, a few at a time. */
async function each<T, R>(items: T[], atOnce: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

/**
 * What the judge makes of the stored answer, by the checks the evals use (evals/lib/buy.ts checkAnswer), on the cards
 * `cardsOf` gives (cards.ts). `clearly` is true when the answer is wrong beyond a doubt a drafted requirement could
 * explain: nothing shown, something asked for with no product that is it, fewer than half the cards right, or a reply
 * that does not respond to the ask. Only a clear failure picks a message on the judge's word alone.
 */
async function judged(made: Case, turn: Turn): Promise<{ failed: string[]; clearly: boolean; note: string }> {
  const { cards, notShown } = cardsOf(turn) ?? { cards: [], notShown: [] };
  const reply = scrub(turn.replies.map((message) => message.body).join("\n\n")).slice(0, 4000);
  const ask = made.messages.length > 1 ? made.messages.map((message, index) => `Message ${index + 1}: ${message}`).join(" ") : made.messages[0]!;
  // The ask's names and addresses were replaced and the reply's were not, so the judge is told not to hold the two against each other.
  const standIns = "Names and street addresses in the shopper's message were replaced with stand-ins such as Alex, Sam and 123 Main St. A reply that uses another name or address is not wrong for that. The chat agent wrote no reply of its own.";
  const verdict = await judge({ ask, wants: made.wants, context: [made.context, standIns].filter(Boolean).join(" ") }, cards, { agentcard: reply, agent: "" }, notShown);
  const failed: string[] = [];
  const share = cards.length > 0 ? verdict.cards.filter((card) => card.accurate).length / cards.length : 0;
  if (cards.length > 0) {
    if (share < 0.8) failed.push("accurate-cards");
    if (!verdict.cards.slice(0, 3).every((card) => card.accurate)) failed.push("top-cards-accurate");
    if (verdict.uncovered.length > 0) failed.push("every-item-covered");
    if (verdict.badRecommendations.length > 0) failed.push("recommended-fits");
  } else if (!made.mayAsk) failed.push("has-cards");
  if (verdict.agentcardFalseClaims.length > 0) failed.push("agentcard-reply-true");
  if (!verdict.answersTheAsk) failed.push("answers-the-ask");
  const clearly = failed.includes("has-cards") || failed.includes("every-item-covered") || failed.includes("answers-the-ask") || (cards.length > 0 && share < 0.5);
  return { failed, clearly, note: scrub(verdict.answerNote) };
}

/** The part of a Braintrust dataset the job uses. */
interface Store {
  insert(row: Record<string, unknown>): string;
  flush(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<{ id: string; input?: { messages?: string[] }; metadata?: { day?: string; company?: string } }>;
}

async function main(): Promise<void> {
  const day = value("--day") ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dry = flag("--dry-run");
  run.day = day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Missing("--day must look like 2026-11-24");
  if (!source()) throw new Missing("nowhere to read conversations from: set REAL_ASKS_DATABASE_URL, or PGHOST with the other PG variables");
  if (!process.env.ANTHROPIC_API_KEY) throw new Missing("ANTHROPIC_API_KEY is not set, so messages can be neither cleaned nor judged");
  if (!dry && !process.env.BRAINTRUST_API_KEY) throw new Missing("BRAINTRUST_API_KEY is not set, so there is nowhere private to save to (--dry-run needs no key)");
  const mostJudged = number("REAL_ASKS_MOST_JUDGED", 150);
  const mostSaved = number("REAL_ASKS_MOST_SAVED", 20);
  // One company's app can send the same kind of ask all day; a few of them say as much as all of them.
  const mostPerCompany = number("REAL_ASKS_MOST_PER_COMPANY", 5);

  run.step = "reading the day's conversations";
  const read = await readDay(day);
  run.conversations = read.counts.all;
  run.read = read.counts.read;
  const failedCheckouts = new Set(read.checkouts.filter((checkout) => checkout.stopped && checkout.stopped !== "shopper_stopped").map((checkout) => checkout.conversation));
  // A conversation that opens with a message this repository's own evals send is the eval suite talking (own-evals.ts).
  const evalAsks = ownEvalAsks();
  const fromEvals = new Set(turnsOf(read).filter((turn) => turn.earlier.length === 0 && isOwnEvalAsk(turn.ask.body, evalAsks)).map((turn) => turn.conversation.id));
  const turns = turnsOf(read).filter((turn) => turn.ask.at.slice(0, 10) === day && !fromEvals.has(turn.conversation.id));
  run.asks = turns.filter(typedAsk).length;
  const signs = new Map<Turn, Sign[]>(turns.map((turn) => [turn, signsOf(turn, failedCheckouts.has(turn.conversation.id))]));
  const bySign: Record<string, number> = {};
  for (const list of signs.values()) for (const sign of list) add(bySign, sign);

  // Every typed ask a rule caught, then the asks whose cards are known, for the judge to read.
  const order = (turn: Turn) => (picks(signs.get(turn)!).length > 0 ? 0 : cardsOf(turn) ? 1 : 2);
  const candidates = turns.filter((turn) => typedAsk(turn) && order(turn) < 2).sort((a, b) => order(a) - order(b) || a.ask.at.localeCompare(b.ask.at)).slice(0, mostJudged);

  run.step = "cleaning and judging the asks";
  const notUsable: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byCheck: Record<string, number> = {};
  let broke = 0;
  const prepared = await each(candidates, 4, async (turn) => {
    try {
      const made = await prepare(turn.ask.body, turn.earlier.map((message) => message.body));
      if (!made.usable) {
        add(notUsable, made.whyNot ?? "not a shopping ask");
        return null;
      }
      // The judge can read an answer only when its cards are known, or when a rule says nothing was shown.
      const caught = picks(signs.get(turn)!);
      const verdict = cardsOf(turn) || caught.includes("nothing found") ? await judged(made, turn) : null;
      return { turn, made, caught, verdict };
    } catch (error) {
      broke += 1;
      console.error(`One message could not be prepared: ${error instanceof Error ? error.name : "error"}`);
      return null;
    }
  });
  run.prepared = candidates.length - broke;
  if (candidates.length > 0 && broke === candidates.length) throw new Error("no message could be cleaned or judged: check ANTHROPIC_API_KEY and the model's availability");
  const usable = prepared.filter((item) => item !== null);
  const judgedOnes = usable.filter((item) => item.verdict);
  const judgeFailed = judgedOnes.filter((item) => item.verdict!.failed.length > 0);
  const judgeFailedClearly = judgeFailed.filter((item) => item.verdict!.clearly);
  for (const item of judgeFailed) for (const check of item.verdict!.failed) add(byCheck, check);

  const chosen = usable
    .map((item) => ({ ...item, why: [...item.caught, ...(item.verdict?.clearly ? ["the judge failed the answer"] : [])] }))
    .filter((item) => item.why.length > 0)
    // The cases with the most signs first: a shopper who said it was wrong and a judge who agrees beats either alone.
    .sort((a, b) => b.why.length - a.why.length);
  run.picked = chosen.length;

  // Leave out what the dataset already holds: the same row, or an ask worded almost the same as one that is kept.
  run.step = "reading the dataset";
  const kept: { id: string; text: string }[] = [];
  const perCompany: Record<string, number> = {};
  const dataset = process.env.BRAINTRUST_API_KEY ? ((await import("braintrust")).initDataset({ project: PROJECT, dataset: DATASET }) as unknown as Store) : null;
  if (dataset) {
    for await (const row of dataset) {
      kept.push({ id: row.id, text: (row.input?.messages ?? []).join(" ") });
      // Rows already saved for this day count toward each company's share, so running a day twice saves nothing twice.
      if (row.metadata?.day === day && row.metadata.company) add(perCompany, row.metadata.company);
    }
  }
  const before = kept.length;
  run.rows = before;
  run.step = "saving the rows";
  let repeats = 0;
  let saved = 0;
  let overPerCompany = 0;
  let cardsStored = 0;
  const toPost: { id: string; messages: string[]; reply: string }[] = [];
  for (const item of chosen) {
    if (saved >= mostSaved) break;
    const id = `real-${hash(`${item.turn.conversation.id}:${item.turn.ask.id}`)}`;
    const text = item.made.messages.join(" ");
    if (kept.some((row) => row.id === id || alike(row.text, text) >= 0.8)) {
      repeats += 1;
      continue;
    }
    const company = hash(item.turn.conversation.company ?? item.turn.conversation.shopper);
    if ((perCompany[company] ?? 0) >= mostPerCompany) {
      overPerCompany += 1;
      continue;
    }
    kept.push({ id, text });
    saved += 1;
    add(perCompany, company);
    add(byKind, item.made.kind);
    const shown = cardsOf(item.turn);
    if (shown?.stored) cardsStored += 1;
    if (dry || !dataset) continue;
    // The answer the shopper got, cut to a sentence or two and cleaned, for whoever reviews the row.
    const reply = await shortReply(item.turn.replies.map((message) => message.body).join("\n\n"), removedWords([item.turn.ask.body, ...item.turn.earlier.map((message) => message.body)], item.made.messages));
    toPost.push({ id, messages: item.made.messages, reply });
    dataset.insert({
      id,
      input: { messages: item.made.messages },
      expected: { wants: item.made.wants, may_ask: item.made.mayAsk, priced: item.made.priced, ...(item.made.context ? { right_answer: item.made.context } : {}) },
      tags: [item.made.kind],
      metadata: {
        // The one field a reviewer changes: to `reviewed` once the requirements are right, or to `rejected`.
        review: DRAFT,
        picked_for: item.why,
        day,
        kind: item.made.kind,
        conversation: hash(item.turn.conversation.id),
        company,
        // What the shopper was shown that day, for whoever reviews the row: product names, and the start of the reply, cleaned.
        seen: {
          reply,
          cards: shown?.cards ?? [],
          cards_are: shown ? (shown.stored ? "the cards the backend stored with the turn" : "a guess: the first products of the conversation's last search") : "not known",
          ...(item.verdict ? { judge_failed: item.verdict.failed, judge_note: item.verdict.note } : {}),
        },
      },
    });
  }
  if (dataset && !dry) await dataset.flush();
  // One short Slack post for each saved row, so a person can review it with an emoji. Without the Slack settings the
  // rows are saved all the same, and `npm run real-asks:post` posts them later.
  const slack = slackTarget();
  if (dataset && !dry && slack && toPost.length > 0) {
    run.step = "posting the rows for review";
    run.posted = (await postRows(dataset as unknown as Updatable, toPost, slack)).length;
  }
  run.saved = dry ? 0 : saved;
  run.rows = dry ? before : before + saved;

  console.log(
    JSON.stringify(
      {
        day,
        dry_run: dry,
        conversations: read.counts,
        conversations_from_this_repository_evals: fromEvals.size,
        shopper_messages: turns.length,
        typed_asks: run.asks,
        turns_with_stored_cards: turns.filter((turn) => cardsOf(turn)?.stored).length,
        caught_by_rule: bySign,
        prepared: candidates.length,
        could_not_prepare: broke,
        not_usable: notUsable,
        usable: usable.length,
        judged: judgedOnes.length,
        judged_on_stored_cards: judgedOnes.filter((item) => cardsOf(item.turn)?.stored).length,
        judge_failed_any_check: judgeFailed.length,
        judge_failed_clearly: judgeFailedClearly.length,
        judge_failed_by_check: byCheck,
        picked: chosen.length,
        already_kept_or_alike: repeats,
        left_out_over_the_cap_per_company: overPerCompany,
        would_save: dry ? saved : undefined,
        saved: run.saved,
        saved_with_stored_cards: cardsStored,
        saved_by_kind: byKind,
        posted_for_review: run.posted,
        rows_before: before,
        rows_now: run.rows,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
  console.log(`real-asks ok: ${line()}`);
} catch (error) {
  // The reason is the error's own short message: a database, model or Braintrust error, none of which repeats a shopper's words.
  const why = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).replace(/\s+/g, " ").replace(/postgres(ql)?:\/\/\S+/gi, "[database address]").slice(0, 300);
  console.error(`real-asks failed: ${error instanceof Missing ? "a setting is missing" : `while ${run.step}`}: ${why} | ${line()}`);
  process.exitCode = error instanceof Missing ? 2 : 1;
}
