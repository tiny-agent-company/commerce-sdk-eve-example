import type { Want } from "./judge.js";

/**
 * Real asks that did not get a good answer, kept as evals.
 *
 * The cases live in a Braintrust dataset and never in this repository: the repository is public and the asks come from
 * real shoppers. A daily job (real-asks/pick.ts) reads the day's conversations, keeps the ones that went badly, removes
 * personal details and saves each as a row. evals/buy/real.eval.ts loads the rows when it runs.
 */
export const PROJECT = "Buy evals";
export const DATASET = "Real asks that failed";

/**
 * The values of a row's `metadata.review`, the one field a reviewer changes in Braintrust's dataset screen.
 * This one: the row's requirements were written by a model and nobody has checked them yet. Any value that is neither
 * `reviewed` nor `rejected` reads as this one, so a typo never makes a row run.
 */
export const DRAFT = "draft, not reviewed";
/** A person has read the row and its requirements are right. */
export const REVIEWED = "reviewed";
/** A person has decided this row should not run: set it in Braintrust instead of deleting the row, so the same ask is not picked again. */
export const REJECTED = "rejected";

/** One row of the dataset, as the eval reads it. */
export interface RealAsk {
  id: string;
  /** What the shopper typed, personal details removed. The last message is the ask; earlier ones are there only when it depends on them. */
  messages: string[];
  /** What the shopper asked for, in the shape the judge reads (judge.ts). */
  wants: Want[];
  /** True when a question back to the shopper is a right answer. */
  mayAsk: boolean;
  /** False for things whose cards carry no price, such as a restaurant table. */
  priced: boolean;
  /** What a right answer looks like when it is not simply "show the thing", such as the reply's language. */
  context?: string;
  /** Why the job picked it: `rephrased`, `said it was wrong`, `the judge failed the answer` and so on. */
  pickedFor: string[];
  /** The day of the conversation, `2026-11-24`. */
  day: string;
  /** The kind of thing asked for: retail, groceries, restaurant food, flights, hotels, services or other. */
  kind: string;
  /** `draft, not reviewed`, `reviewed` or `rejected`. */
  review: string;
}

interface Row {
  id: string;
  input?: { messages?: unknown };
  expected?: { wants?: unknown; may_ask?: unknown; priced?: unknown; right_answer?: unknown };
  metadata?: { picked_for?: unknown; day?: unknown; kind?: unknown; review?: unknown };
}

/** Reads one dataset row, or returns null when it does not hold an ask and its requirements. */
export function readRow(row: Row): RealAsk | null {
  const messages = Array.isArray(row.input?.messages) ? row.input.messages.filter((message): message is string => typeof message === "string" && message.trim().length > 0) : [];
  const wants = Array.isArray(row.expected?.wants)
    ? (row.expected.wants as { what?: unknown; must?: unknown }[])
        .filter((want) => typeof want?.what === "string")
        .map((want) => ({ what: want.what as string, must: Array.isArray(want.must) ? want.must.filter((must): must is string => typeof must === "string") : [] }))
    : [];
  if (messages.length === 0 || wants.length === 0) return null;
  return {
    id: row.id,
    messages,
    wants,
    mayAsk: row.expected?.may_ask === true,
    priced: row.expected?.priced !== false,
    context: typeof row.expected?.right_answer === "string" && row.expected.right_answer ? row.expected.right_answer : undefined,
    pickedFor: Array.isArray(row.metadata?.picked_for) ? row.metadata.picked_for.map(String) : [],
    day: typeof row.metadata?.day === "string" ? row.metadata.day : "",
    kind: typeof row.metadata?.kind === "string" ? row.metadata.kind : "other",
    review: [REVIEWED, REJECTED].includes(String(row.metadata?.review).trim().toLowerCase()) ? String(row.metadata?.review).trim().toLowerCase() : DRAFT,
  };
}

/**
 * Loads every row of the dataset from Braintrust. Never throws: without a key, or when Braintrust cannot be reached, it
 * returns no rows and says why, so the eval that reads it skips instead of failing the run.
 */
export async function loadRealAsks(): Promise<{ rows: RealAsk[]; unreadable: number; why?: string }> {
  if (!process.env.BRAINTRUST_API_KEY) return { rows: [], unreadable: 0, why: "BRAINTRUST_API_KEY is not set, so the real asks cannot be loaded" };
  try {
    const { initDataset } = await import("braintrust");
    const dataset = initDataset({ project: PROJECT, dataset: DATASET });
    const rows: RealAsk[] = [];
    let unreadable = 0;
    for await (const row of dataset) {
      const read = readRow(row as Row);
      if (read) rows.push(read);
      else unreadable += 1;
    }
    return { rows, unreadable, why: rows.length === 0 ? `the Braintrust dataset "${DATASET}" has no rows yet` : undefined };
  } catch (error) {
    return { rows: [], unreadable: 0, why: `the Braintrust dataset "${DATASET}" could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * The rows one run sends, at most `limit`, so a day's cost stays bounded however long the dataset grows. Only rows a
 * person marked `reviewed` run: a draft's requirements were written by a model, and an eval that fails against wrong
 * requirements says nothing. `drafts` also runs the rows nobody has reviewed yet, for a run made on purpose by hand;
 * reviewed rows still go first, then the newest. Rejected rows never run.
 */
export function rowsToRun(rows: RealAsk[], limit: number, drafts = false): RealAsk[] {
  const order = (row: RealAsk) => (row.review === REVIEWED ? 0 : 1);
  return rows
    .filter((row) => row.review === REVIEWED || (drafts && row.review !== REJECTED))
    .sort((a, b) => order(a) - order(b) || b.day.localeCompare(a.day) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

/** How many rows wait for a person to review them. */
export function draftsWaiting(rows: RealAsk[]): number {
  return rows.filter((row) => row.review === DRAFT).length;
}
