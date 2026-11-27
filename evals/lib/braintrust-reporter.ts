import type { EveEvalResult } from "eve/evals";
import type { EvalReporter, EveEvalCompleteContext } from "eve/evals/reporters";
import { linesOfLastChat } from "./connection.ts";
import { failedChecks, kindOf, outcomeOf } from "./outcome.ts";

/** The line checkAnswer logs for each graded turn (lib/buy.ts), which this reporter turns into a row's output. */
export const RECORD = "RECORD ";

interface Experiment {
  log(row: Record<string, unknown>): unknown;
  summarize(): Promise<{ experimentUrl?: string }>;
  close(): Promise<unknown>;
}

/**
 * Saves a run to Braintrust as one experiment, one row per eval, so a row reads as the conversation it was:
 *
 * - Input: the messages the shopper sent, in order.
 * - Output: for each graded turn, the product cards the shopper saw, Agentcard's reply and the chat agent's reply.
 * - Expected: what the shopper asked for, as the requirements each card was checked against.
 * - Scores: every check, by its name. A check recorded for more than one turn keeps its lowest score.
 * - Metadata: the eval's id and name, its verdict, each check that did not pass with the judge's reason, and how the
 *   run ended as one kind under `result` (lib/outcome.ts): `passed`, `failed`, `store's own answer`, `example app's
 *   mistake`, `run broke` or `skipped`. A store's own answer is under `store_answer`, and each message the example chat
 *   app answered itself under `app_mistakes`. The kind is also a tag, `result: failed`, to filter a run by.
 *
 * When a run sends each eval several times, every run of an eval is a row of its own, with its number under `attempt`:
 * group the rows by `eval` to read how many of them passed.
 *
 * Runs only when `BRAINTRUST_API_KEY` is set.
 */
export function braintrustReporter(config: { projectName: string }): EvalReporter {
  let experiment: Experiment | undefined;
  let flush: (() => Promise<unknown>) | undefined;
  return {
    async onRunStart() {
      if (!process.env.BRAINTRUST_API_KEY) return;
      const braintrust = await import("braintrust");
      flush = () => braintrust.flush();
      experiment = braintrust.init({ project: config.projectName, noExitFlush: true, setCurrent: false }) as unknown as Experiment;
    },
    onEvalComplete(result: EveEvalResult, context?: EveEvalCompleteContext) {
      if (!experiment) return;
      const about = context?.evaluation;
      // A chat run again because its connection broke is read from its last run, the one the eval was graded on.
      const turns = linesOfLastChat(result.result.logs ?? []).filter((line) => line.startsWith(RECORD)).map((line) => JSON.parse(line.slice(RECORD.length)) as { wants?: unknown; context?: unknown; [key: string]: unknown });
      const scores: Record<string, number> = {};
      for (const assertion of result.assertions) {
        if (assertion.score === undefined) continue;
        const name = assertion.key ?? assertion.name;
        scores[name] = Math.min(scores[name] ?? 1, assertion.score);
      }
      const messages = about?.metadata?.messages ?? (about?.metadata?.ask ? [about.metadata.ask] : []);
      const kind = kindOf({ verdict: result.verdict, error: result.error, assertions: result.assertions, logs: result.result.logs });
      const outcome = outcomeOf(result.result.logs);
      experiment.log({
        id: result.attempt ? `${result.id}#${result.attempt}` : result.id,
        input: { messages },
        output: {
          agent_reply: result.result.reply ?? null,
          turns: turns.map(({ wants: _wants, context: _context, ...turn }) => turn),
        },
        expected: turns.map((turn) => ({ wants: turn.wants, ...(turn.context ? { right_answer: turn.context } : {}) })),
        error: result.error,
        scores,
        tags: [...(about?.tags ?? []), `result: ${kind}`],
        metadata: {
          eval: result.id,
          name: about?.description,
          verdict: result.verdict,
          result: kind,
          ...(result.attempt ? { attempt: result.attempt } : {}),
          ...(outcome.store_answer ? { store_answer: outcome.store_answer } : {}),
          ...(outcome.app_mistakes?.length ? { app_mistakes: outcome.app_mistakes } : {}),
          ...(outcome.broke ? { run_broke: outcome.broke } : {}),
          tools_called: result.result.derived.toolCalls.map((call) => call.name),
          did_not_pass: failedChecks(result.assertions).map((assertion) => ({ check: assertion.key ?? assertion.name, score: assertion.score, needs: assertion.threshold, why: assertion.message })),
        },
      });
    },
    async onRunComplete() {
      if (!experiment) return;
      try {
        await flush?.();
        const summary = await experiment.summarize();
        if (summary.experimentUrl) console.log(`Braintrust experiment: ${summary.experimentUrl}\n`);
      } finally {
        await experiment.close();
        experiment = undefined;
      }
    },
  };
}
