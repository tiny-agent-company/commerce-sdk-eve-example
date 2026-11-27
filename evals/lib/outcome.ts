import type { StoreAnswer } from "./store-answer.ts";

/**
 * How one run of an eval ended, as one of a few kinds, so that a failure of Agentcard's is never mixed with something
 * else that went wrong, and nothing that went wrong is hidden:
 *
 * - `passed`: every check held.
 * - `failed`: a check about Agentcard did not hold. This is the only kind counted against Agentcard.
 * - `store's own answer`: the store was out of stock, charges another price than the card showed, has no seats or
 *   needs the shopper's own account, and Agentcard said so (lib/store-answer.ts). Not a failure and not a pass.
 * - `example app's mistake`: the example chat app in this repository got it wrong, and nothing of Agentcard's did: its
 *   model answered the shopper itself instead of calling the buy tool, or wrote a link, or changed the shopper's words.
 * - `run broke`: the eval's own connection to the chat dropped twice, so there is nothing to grade.
 * - `skipped`: the eval did not run, with its reason.
 *
 * An eval records what it saw as one log line (`OUTCOME`), and the reporters (Slack, Braintrust and the console) read
 * the kind from that line and from which checks failed. When the daily run sends every cart and checkout eval three
 * times, the runs of one eval are counted together: "passed 2 of 3".
 */
export const OUTCOME = "OUTCOME ";

export type Kind = "passed" | "failed" | "store's own answer" | "example app's mistake" | "run broke" | "skipped";

/** Every kind, in the order a summary lists them. */
export const KINDS: Kind[] = ["passed", "failed", "store's own answer", "example app's mistake", "run broke", "skipped"];

/** What an eval saw that is not a check's failure. */
export interface Outcome {
  /** The store's own answer that ended the chat. */
  store_answer?: StoreAnswer;
  /** Each message the example chat app answered itself, with what it said. */
  app_mistakes?: { said: string; reply: string }[];
  /** Why the chat's connection could not be kept, when it dropped twice. */
  broke?: string;
}

/** The checks that are about the example chat app's own behaviour, by label. Everything else is about Agentcard. */
export const APP_CHECKS = new Set(["app-called-the-buy-tool", "agent-replies", "no-link-in-reply", "shopper-words-unchanged", "agent-reply-true"]);

/** The checks that only say the chat's connection dropped. */
export const CONNECTION_CHECKS = new Set(["chat-stayed-connected", "succeeded", "noFailedCalls"]);

/** One check of a finished run, reduced to what the kind is read from. */
export interface CheckResult {
  key?: string;
  name: string;
  passed?: boolean;
  errored: boolean;
}

/** One finished run of an eval, reduced to what the kind is read from. */
export interface RunResult {
  verdict: string;
  error?: string;
  assertions: readonly CheckResult[];
  logs?: readonly string[];
}

/** The outcome an eval logged, or an empty one when it logged none, as the search evals do. */
export function outcomeOf(logs: readonly string[] | undefined): Outcome {
  const line = [...(logs ?? [])].reverse().find((one) => one.startsWith(OUTCOME));
  if (!line) return {};
  try {
    return JSON.parse(line.slice(OUTCOME.length)) as Outcome;
  } catch {
    return {};
  }
}

/** The checks of a run that did not hold. */
export function failedChecks<T extends CheckResult>(assertions: readonly T[]): T[] {
  return assertions.filter((assertion) => assertion.errored || assertion.passed === false);
}

/** The kind of one finished run. */
export function kindOf(run: RunResult): Kind {
  if (run.verdict === "skipped") return "skipped";
  const outcome = outcomeOf(run.logs);
  const failed = failedChecks(run.assertions).map((check) => check.key ?? check.name);
  if (failed.length === 0 && !run.error) return outcome.store_answer ? "store's own answer" : "passed";
  if (outcome.broke && failed.every((check) => CONNECTION_CHECKS.has(check))) return "run broke";
  // A run that broke for no check's reason (it timed out, or threw) is counted as a failure: nothing shows it was not.
  if (failed.length > 0 && failed.every((check) => APP_CHECKS.has(check) || (outcome.broke !== undefined && CONNECTION_CHECKS.has(check)))) return "example app's mistake";
  return "failed";
}

/** How many runs ended as each kind. */
export function countKinds(kinds: readonly Kind[]): Record<Kind, number> {
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<Kind, number>;
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}

const READS: Record<Kind, string> = {
  passed: "passed",
  failed: "failed",
  "store's own answer": "got the store's own answer",
  "example app's mistake": "hit a mistake of the example chat app",
  "run broke": "broke before it could be graded",
  skipped: "was skipped",
};

/**
 * The runs of one eval as one line: "Passed 2 of 3 runs. 1 failed." A single run reads as its kind alone. Skipped runs
 * are left out of the count, since they never ran.
 */
export function rateLine(kinds: readonly Kind[]): string {
  const ran = kinds.filter((kind) => kind !== "skipped");
  if (ran.length === 0) return "Skipped.";
  const counts = countKinds(ran);
  if (ran.length === 1) return `This run ${READS[ran[0]!]}.`;
  const rest = KINDS.filter((kind) => kind !== "passed" && kind !== "skipped" && counts[kind] > 0).map((kind) => `${counts[kind]} ${READS[kind]}`);
  return `Passed ${counts.passed} of ${ran.length} runs.${rest.length ? ` ${rest.join(", ")}.` : ""}`;
}

/** The counts of a whole run as one line: "159 runs: 120 passed, 20 failed, ...". Kinds nothing ended as are left out. */
export function countsLine(kinds: readonly Kind[]): string {
  const counts = countKinds(kinds);
  const parts = KINDS.filter((kind) => counts[kind] > 0).map((kind) => `${counts[kind]} ${kind}`);
  return `${kinds.length} run${kinds.length === 1 ? "" : "s"}: ${parts.join(", ") || "none"}`;
}
