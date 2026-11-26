/**
 * The daily job: reads one day of real buy conversations, keeps the shopper messages that did not get a good answer,
 * removes personal details and saves each as a row of the private Braintrust dataset the `real` evals run from.
 *
 *   node real-asks/pick.ts                 # yesterday (UTC)
 *   node real-asks/pick.ts --day 2026-11-24
 *   node real-asks/pick.ts --dry-run       # everything but the save
 *
 * It prints numbers only. A shopper's words are never printed, logged or written to a file: they go from the source to
 * the model that cleans them and into Braintrust, and nowhere else.
 */
import { createHash } from "node:crypto";
import { judge } from "../evals/lib/judge.ts";
import { DATASET, DRAFT, PROJECT } from "../evals/lib/real-asks.ts";
import { prepare, type Case } from "./prepare.ts";
import { readDay, source } from "./read.ts";
import { alike, scrub } from "./scrub.ts";
import { picks, signsOf, turnsOf, typedAsk, type Sign, type Turn } from "./signals.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const number = (name: string, fallback: number) => (Number.isFinite(Number(process.env[name])) && process.env[name] ? Number(process.env[name]) : fallback);

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const add = (counts: Record<string, number>, key: string) => void (counts[key] = (counts[key] ?? 0) + 1);

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

/** An answer shows at most this many products as cards; the backend keeps more of each search than it shows. */
const CARDS_SHOWN = 8;

/**
 * What the judge makes of the stored answer, by the checks the evals use (evals/lib/buy.ts checkAnswer). The backend
 * keeps a search's products in order but not which of them became cards, so the first eight stand for the cards and
 * the rest for products found and not shown. `clearly` is true when the answer is wrong beyond a doubt a drafted
 * requirement could explain: nothing shown, something asked for with no product that is it, fewer than half the cards
 * right, or a reply that does not respond to the ask. Only a clear failure picks a message on the judge's word alone.
 */
async function judged(made: Case, turn: Turn): Promise<{ failed: string[]; clearly: boolean; note: string }> {
  const [cards, notShown] = [(turn.products ?? []).slice(0, CARDS_SHOWN), (turn.products ?? []).slice(CARDS_SHOWN)];
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
  [Symbol.asyncIterator](): AsyncIterator<{ id: string; input?: { messages?: string[] } }>;
}

async function main(): Promise<void> {
  const day = value("--day") ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dry = flag("--dry-run");
  if (!source()) {
    console.log("Skipped: nowhere to read conversations from. Set REAL_ASKS_EXPORT_URL, REAL_ASKS_DATABASE_URL or REAL_ASKS_FILE.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Skipped: ANTHROPIC_API_KEY is not set, so messages can be neither cleaned nor judged.");
    return;
  }
  if (!dry && !process.env.BRAINTRUST_API_KEY) {
    console.log("Skipped: BRAINTRUST_API_KEY is not set, so there is nowhere private to save to. Use --dry-run to see the numbers.");
    return;
  }
  const mostJudged = number("REAL_ASKS_MOST_JUDGED", 150);
  const mostSaved = number("REAL_ASKS_MOST_SAVED", 20);
  // One company's app can send the same kind of ask all day; a few of them say as much as all of them.
  const mostPerCompany = number("REAL_ASKS_MOST_PER_COMPANY", 5);

  const read = await readDay(day);
  const failedCheckouts = new Set(read.checkouts.filter((checkout) => checkout.stopped && checkout.stopped !== "shopper_stopped").map((checkout) => checkout.conversation));
  const turns = turnsOf(read).filter((turn) => turn.ask.at.slice(0, 10) === day);
  const signs = new Map<Turn, Sign[]>(turns.map((turn) => [turn, signsOf(turn, failedCheckouts.has(turn.conversation.id))]));
  const bySign: Record<string, number> = {};
  for (const list of signs.values()) for (const sign of list) add(bySign, sign);

  // Every typed ask a rule caught, then the asks whose products the backend still holds, for the judge to read.
  const order = (turn: Turn) => (picks(signs.get(turn)!).length > 0 ? 0 : turn.products ? 1 : 2);
  const candidates = turns.filter((turn) => typedAsk(turn) && order(turn) < 2).sort((a, b) => order(a) - order(b) || a.ask.at.localeCompare(b.ask.at)).slice(0, mostJudged);

  const notUsable: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byCheck: Record<string, number> = {};
  let broke = 0;
  const read_ = await each(candidates, 4, async (turn) => {
    try {
      const made = await prepare(turn.ask.body, turn.earlier.map((message) => message.body));
      if (!made.usable) {
        add(notUsable, made.whyNot ?? "not a shopping ask");
        return null;
      }
      // The judge can read an answer only when its products are still stored, or when a rule says nothing was shown.
      const caught = picks(signs.get(turn)!);
      const verdict = turn.products || caught.includes("nothing found") ? await judged(made, turn) : null;
      return { turn, made, caught, verdict };
    } catch (error) {
      broke += 1;
      console.error(`One message could not be prepared: ${error instanceof Error ? error.name : "error"}`);
      return null;
    }
  });
  const usable = read_.filter((item) => item !== null);
  const judgedCount = usable.filter((item) => item.verdict).length;
  const judgeFailed = usable.filter((item) => item.verdict && item.verdict.failed.length > 0);
  const judgeFailedClearly = judgeFailed.filter((item) => item.verdict!.clearly);
  for (const item of judgeFailed) for (const check of item.verdict!.failed) add(byCheck, check);

  const chosen = usable
    .map((item) => ({ ...item, why: [...item.caught, ...(item.verdict?.clearly ? ["the judge failed the answer"] : [])] }))
    .filter((item) => item.why.length > 0)
    // The cases with the most signs first: a shopper who said it was wrong and a judge who agrees beats either alone.
    .sort((a, b) => b.why.length - a.why.length);

  // Leave out what the dataset already holds: the same row, or an ask worded almost the same as one that is kept.
  const kept: { id: string; text: string }[] = [];
  const dataset = process.env.BRAINTRUST_API_KEY ? ((await import("braintrust")).initDataset({ project: PROJECT, dataset: DATASET }) as unknown as Store) : null;
  if (dataset) for await (const row of dataset) kept.push({ id: row.id, text: (row.input?.messages ?? []).join(" ") });
  const before = kept.length;
  let repeats = 0;
  let saved = 0;
  let overPerCompany = 0;
  const perCompany: Record<string, number> = {};
  for (const item of chosen) {
    if (saved >= mostSaved) break;
    const company = item.turn.conversation.company ?? item.turn.conversation.shopper;
    if ((perCompany[company] ?? 0) >= mostPerCompany) {
      overPerCompany += 1;
      continue;
    }
    const id = `real-${hash(`${item.turn.conversation.id}:${item.turn.ask.id}`)}`;
    const text = item.made.messages.join(" ");
    if (kept.some((row) => row.id === id || alike(row.text, text) >= 0.8)) {
      repeats += 1;
      continue;
    }
    kept.push({ id, text });
    saved += 1;
    add(perCompany, company);
    add(byKind, item.made.kind);
    if (dry || !dataset) continue;
    dataset.insert({
      id,
      input: { messages: item.made.messages },
      expected: { wants: item.made.wants, may_ask: item.made.mayAsk, priced: item.made.priced, ...(item.made.context ? { right_answer: item.made.context } : {}) },
      tags: [item.made.kind],
      metadata: {
        review: DRAFT,
        picked_for: item.why,
        day,
        kind: item.made.kind,
        conversation: hash(item.turn.conversation.id),
        // What the shopper was shown that day, for whoever reviews the row. Product names only; the reply is left out.
        seen: { products: (item.turn.products ?? []).slice(0, CARDS_SHOWN), ...(item.verdict ? { judge_failed: item.verdict.failed, judge_note: item.verdict.note } : {}) },
      },
    });
  }
  if (dataset && !dry) await dataset.flush();

  const typed = turns.filter(typedAsk).length;
  console.log(
    JSON.stringify(
      {
        day,
        dry_run: dry,
        conversations: read.counts,
        shopper_messages: turns.length,
        typed_asks: typed,
        caught_by_rule: bySign,
        prepared: candidates.length,
        could_not_prepare: broke,
        not_usable: notUsable,
        usable: usable.length,
        judged: judgedCount,
        judge_failed_any_check: judgeFailed.length,
        judge_failed_clearly: judgeFailedClearly.length,
        judge_failed_by_check: byCheck,
        picked: chosen.length,
        already_kept_or_alike: repeats,
        left_out_over_the_cap_per_company: overPerCompany,
        saved,
        saved_by_kind: byKind,
        rows_before: before,
        rows_now: dry ? before : before + saved,
      },
      null,
      2,
    ),
  );
}

await main();
