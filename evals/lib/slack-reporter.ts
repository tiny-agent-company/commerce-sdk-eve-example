import { transcriptOf } from "eve/client";
import type { EveEvalResult } from "eve/evals";
import type { EvalReporter, EveEvalCompleteContext } from "eve/evals/reporters";
import { countsLine, failedChecks, kindOf, outcomeOf, rateLine, type Kind, type Outcome } from "./outcome.ts";

/** One run of an eval: how it ended, and for a run that did not pass, its conversation word for word and the reasons its checks gave. */
export interface Run {
  attempt: number;
  kind: Kind;
  outcome: Outcome;
  messages: { role: "user" | "assistant"; text: string }[];
  reasons: string[];
}

/** Every run of one eval. The daily run sends each cart and checkout eval three times. */
export interface Eval {
  id: string;
  name: string;
  runs: Run[];
}

/**
 * Why one check failed, as a sentence. A rule written as `satisfies(...)` reports "predicate did not hold for <value>",
 * which says nothing to a reader, so its own description is used instead, with the value on the next line.
 */
function reasonOf(assertion: EveEvalResult["assertions"][number]): string {
  const message = assertion.message ?? "";
  const described = /^satisfies\((.*)\)( \[[^\]]+\])?$/s.exec(assertion.name)?.[1];
  if (described && (!message || message.startsWith("predicate did not hold"))) {
    const value = message.replace(/^predicate did not hold for /, "").trim().replace(/^"|"$/g, "").replace(/…$/, "");
    if (value && described.includes(value.slice(0, 40))) {
      // A label written as "what should happen: what happened instead".
      const [should, ...instead] = described.split(": ");
      return `This did not happen: ${should!.charAt(0).toUpperCase() + should!.slice(1)}.\n   ◦ ${instead.join(": ")}`;
    }
    const sentence = described.charAt(0).toUpperCase() + described.slice(1);
    return value && value !== "null" && value !== "false" && value !== "true" && !/^[[{]/.test(value) ? `This did not hold: ${sentence}.\n   ◦ ${value}` : `This did not hold: ${sentence}.`;
  }
  return message || assertion.key || assertion.name;
}

/** How many evals one run posts. Braintrust holds every one. */
const MOST_POSTED = 25;

/** Slack reads `&`, `<` and `>` as markup, so text from a store or a model is escaped before it is posted. */
function plain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Text as a Slack quote, every line of it, under a short label. */
function quoted(label: string, text: string): string {
  return `*${label}*\n${plain(text).slice(0, 3500).split("\n").map((line) => `>${line}`).join("\n")}`;
}

/** Slack takes about one message a second in a channel and refuses faster posts, so each post waits its turn and retries once when refused. */
async function post(token: string, body: Record<string, unknown>): Promise<string | null> {
  await new Promise((done) => setTimeout(done, 1200));
  const first = await send(token, body);
  if (first !== "ratelimited") return first;
  await new Promise((done) => setTimeout(done, 30_000));
  const again = await send(token, body);
  return again === "ratelimited" ? null : again;
}

async function send(token: string, body: Record<string, unknown>): Promise<string | null | "ratelimited"> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ unfurl_links: false, unfurl_media: false, ...body }),
  });
  const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (answer.error === "ratelimited") return "ratelimited";
  if (!answer.ok) console.error(`Slack did not take the eval report: ${answer.error}`);
  return answer.ok ? (answer.ts ?? null) : null;
}

/**
 * The eval's conversation, word for word: each message sent to the agent and each reply it gave, in order. The
 * agent's replies within one turn are joined into one.
 */
function conversationOf(result: EveEvalResult): Run["messages"] {
  const events = result.result.sessions?.[0]?.events ?? result.result.events;
  const messages: Run["messages"] = [];
  for (const message of transcriptOf(events).messages) {
    const last = messages.at(-1);
    if (last && last.role === message.role) last.text = `${last.text}\n\n${message.text}`;
    else messages.push({ role: message.role, text: message.text });
  }
  return messages;
}

/** The kinds of run that get a post of their own, the one counted against Agentcard first. */
const POSTED: Kind[] = ["failed", "example app's mistake", "run broke"];

/** The run of an eval a post shows: the first that failed, else the first the example chat app got wrong, else the first that broke. Null when none did. */
export function shownRun(runs: readonly Run[]): Run | null {
  for (const kind of POSTED) {
    const run = runs.find((one) => one.kind === kind);
    if (run) return run;
  }
  return null;
}

/** The headline over an eval's reasons, by what went wrong in the run the post shows. */
const HEADLINE: Record<string, string> = {
  failed: "Why the eval failed:",
  "example app's mistake": "The example chat app's mistake (counted apart from Agentcard's failures):",
  "run broke": "The run broke (not a failure of Agentcard's):",
};

/**
 * The last reply of an eval's thread: how many of its runs passed and what each other one ended as, then the reasons
 * of the run the thread shows, then the reasons of any other run that did not pass for a different reason. Runs that
 * gave the same reasons are named together, so three runs never say one thing three times.
 */
export function whyText(evaluation: Eval, shown: Run): string {
  const repeated = evaluation.runs.length > 1;
  const lines: string[] = [`*${HEADLINE[shown.kind] ?? HEADLINE.failed}*`];
  if (repeated) lines.push(`${rateLine(evaluation.runs.map((run) => run.kind))} This thread shows run ${shown.attempt}.`);
  const bullets = (reasons: string[]) => reasons.map((reason) => `• ${plain(reason.slice(0, 1200))}`).join("\n");
  const same = (a: Run, b: Run) => a.kind === b.kind && a.reasons.join("\n") === b.reasons.join("\n");
  const others = evaluation.runs.filter((run) => run !== shown && POSTED.includes(run.kind));
  const alike = others.filter((run) => same(run, shown));
  if (repeated && alike.length > 0) lines.push(`Run${alike.length > 1 ? "s" : ""} ${alike.map((run) => run.attempt).join(" and ")} ended the same way.`);
  lines.push(bullets(shown.reasons));
  const told: Run[] = [];
  for (const run of others.filter((one) => !same(one, shown))) {
    if (told.some((one) => same(one, run))) continue;
    told.push(run);
    const twins = others.filter((one) => same(one, run)).map((one) => one.attempt);
    lines.push(`*Run${twins.length > 1 ? "s" : ""} ${twins.join(" and ")}${run.kind === "failed" ? " failed differently" : run.kind === "run broke" ? " broke" : ": the example chat app's mistake"}:*\n${bullets(run.reasons)}`);
  }
  for (const run of evaluation.runs.filter((one) => one.kind === "store's own answer")) {
    const answer = run.outcome.store_answer;
    if (answer) lines.push(`_Run ${run.attempt} got the store's own answer, which is not a failure: ${answer.what}._`);
  }
  return lines.join("\n").slice(0, 3500);
}

/**
 * One message for the whole run: how many runs ended as each kind, then every eval that got a store's own answer, every
 * mistake of the example chat app, and every eval that passed only some of its runs. Null when it would add nothing to
 * the evals' own posts: every run passed or was skipped, or each eval ran once and only passed or failed.
 */
export function summaryText(evals: readonly Eval[]): string | null {
  const kinds = evals.flatMap((evaluation) => evaluation.runs.map((run) => run.kind));
  if (kinds.every((kind) => kind === "passed" || kind === "skipped")) return null;
  const most = Math.max(...evals.map((evaluation) => evaluation.runs.length));
  // Evals that ran once and only passed or failed are told in full by their own posts.
  if (most === 1 && kinds.every((kind) => kind === "passed" || kind === "skipped" || kind === "failed")) return null;
  const lines: string[] = [`*How this run of the evals went*`, `${evals.length} evals${most > 1 ? `, each run ${most} times` : ""}. ${countsLine(kinds)}. Only "failed" is counted against Agentcard.`];
  const list = (title: string, entries: string[]) => {
    if (entries.length === 0) return;
    lines.push(`*${title}*`, ...entries.slice(0, 30).map((entry) => `• ${plain(entry)}`), ...(entries.length > 30 ? [`• and ${entries.length - 30} more, in Braintrust`] : []));
  };
  const of = (evaluation: Eval, kind: Kind) => evaluation.runs.filter((run) => run.kind === kind);
  list(
    "The store's own answer (not a failure, and not a pass):",
    evals.flatMap((evaluation) => {
      const runs = of(evaluation, "store's own answer");
      if (runs.length === 0) return [];
      const whats = [...new Set(runs.map((run) => run.outcome.store_answer?.what ?? "unknown"))].join("; ");
      const answer = runs[0]!.outcome.store_answer;
      return [`${evaluation.name}: ${whats}${evaluation.runs.length > 1 ? `, in ${runs.length} of ${evaluation.runs.length} runs` : ""}. Read from ${answer?.read_from ?? "the answer"}. Agentcard said: ${(answer?.said ?? "").slice(0, 220)}`];
    }),
  );
  list(
    "The example chat app's mistakes (it answered the shopper itself instead of calling the buy tool):",
    evals.flatMap((evaluation) => {
      const runs = evaluation.runs.filter((run) => (run.outcome.app_mistakes ?? []).length > 0);
      if (runs.length === 0) return [];
      const first = runs[0]!.outcome.app_mistakes![0]!;
      return [`${evaluation.name}${evaluation.runs.length > 1 ? `, in ${runs.length} of ${evaluation.runs.length} runs` : ""}: after "${first.said.slice(0, 80)}" it said: ${first.reply.slice(0, 200)}`];
    }),
  );
  list(
    "Passed only some of the time:",
    evals.flatMap((evaluation) => {
      const ran = evaluation.runs.filter((run) => run.kind !== "skipped");
      const passed = of(evaluation, "passed").length;
      return ran.length > 1 && passed > 0 && passed < ran.length ? [`${evaluation.name}: ${rateLine(evaluation.runs.map((run) => run.kind))}`] : [];
    }),
  );
  list(
    "Failed every time:",
    evals.flatMap((evaluation) => {
      const ran = evaluation.runs.filter((run) => run.kind !== "skipped");
      return ran.length > 1 && of(evaluation, "failed").length === ran.length ? [evaluation.name] : [];
    }),
  );
  return lines.join("\n").slice(0, 11_000);
}

/**
 * Posts the evals that did not pass to a Slack channel, one post per eval however many times it ran:
 * - the post is the first message sent to the agent, word for word;
 * - its thread holds the agent's reply, then each next message and reply, word for word, of one run that did not pass;
 * - the last reply in the thread says how many of the eval's runs passed and why the others did not, one line per
 *   failed check.
 *
 * A run of the evals then gets one closing message that counts every run by how it ended (lib/outcome.ts) and lists
 * what is neither a pass nor a failure of Agentcard's: each store's own answer and each mistake of the example chat app.
 * A run where everything passed posts nothing. A run posts at most 25 evals. The same counts are printed to the console
 * whether or not Slack is set.
 *
 * Reads `SLACK_BOT_TOKEN` and `SLACK_EVALS_CHANNEL` (a channel id). Without both it posts nothing, so a local run
 * stays quiet.
 */
export function slackReporter(): EvalReporter {
  const evals = new Map<string, Eval>();
  return {
    onRunStart() {},
    onEvalComplete(result: EveEvalResult, context?: EveEvalCompleteContext) {
      const kind = kindOf({ verdict: result.verdict, error: result.error, assertions: result.assertions, logs: result.result.logs });
      const passed = kind === "passed" || kind === "skipped" || kind === "store's own answer";
      const evaluation = evals.get(result.id) ?? { id: result.id, name: context?.evaluation?.description ?? result.id, runs: [] };
      evals.set(result.id, evaluation);
      evaluation.runs.push({
        attempt: result.attempt ?? evaluation.runs.length + 1,
        kind,
        outcome: outcomeOf(result.result.logs),
        // Only a run a post can show keeps its conversation.
        messages: passed ? [] : conversationOf(result),
        reasons: passed ? [] : [...(result.error ? [`The run broke: ${result.error}`] : []), ...failedChecks(result.assertions).map(reasonOf)],
      });
    },
    async onRunComplete() {
      const all = [...evals.values()].map((evaluation) => ({ ...evaluation, runs: [...evaluation.runs].sort((a, b) => a.attempt - b.attempt) }));
      const summary = summaryText(all);
      // The counts by kind, and each eval that ran more than once, for whoever reads the console or the run's log.
      const kinds = all.flatMap((evaluation) => evaluation.runs.map((run) => run.kind));
      console.log(`\nResults by kind: ${countsLine(kinds)}`);
      for (const evaluation of all) {
        const ran = evaluation.runs.filter((run) => run.kind !== "skipped");
        if (ran.length > 1 || ran.some((run) => run.kind !== "passed")) console.log(`  ${evaluation.id}  ${ran.map((run) => run.kind).join(" | ") || "skipped"}  (${evaluation.name})`);
      }
      const failures = all.flatMap((evaluation) => {
        const shown = shownRun(evaluation.runs);
        return shown ? [{ evaluation, shown }] : [];
      });
      if (failures.length === 0 && !summary) return;
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_EVALS_CHANNEL;
      if (!token || !channel) {
        console.error("Set SLACK_BOT_TOKEN and SLACK_EVALS_CHANNEL to send failed evals to Slack.");
        return;
      }
      // Failures of Agentcard's are posted before the example chat app's mistakes, so the cap never hides one behind the other.
      failures.sort((a, b) => POSTED.indexOf(a.shown.kind) - POSTED.indexOf(b.shown.kind));
      for (const { evaluation, shown } of failures.slice(0, MOST_POSTED)) {
        const [first, ...rest] = shown.messages;
        const opener = first?.role === "user";
        const thread = await post(token, { channel, text: quoted("Message sent to the agent:", opener ? first.text : "(no message was sent)") });
        if (!thread) continue;
        for (const message of opener ? rest : shown.messages) {
          await post(token, { channel, thread_ts: thread, text: quoted(message.role === "user" ? "Message sent to the agent:" : "Agent's reply:", message.text) });
        }
        await post(token, { channel, thread_ts: thread, text: whyText(evaluation, shown) });
      }
      if (summary) {
        const [head, ...more] = summary.match(/[\s\S]{1,3500}(?:\n|$)/g) ?? [summary];
        const thread = await post(token, { channel, text: head! });
        for (const part of thread ? more : []) await post(token, { channel, thread_ts: thread, text: part });
      }
    },
  };
}
