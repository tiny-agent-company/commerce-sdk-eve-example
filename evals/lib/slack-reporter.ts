import type { EveEvalResult, EveEvalRunSummary } from "eve/evals";
import type { EvalReporter, EveEvalCompleteContext } from "eve/evals/reporters";

interface Failure {
  title: string;
  ask: string | null;
  reply: string | null;
  verdict: string;
  lines: string[];
}

/** Slack reads `&`, `<` and `>` as markup, so text from a store or a model is escaped before it is posted. */
function plain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function post(token: string, body: Record<string, unknown>): Promise<string | null> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ unfurl_links: false, ...body }),
  });
  const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (!answer.ok) console.error(`Slack did not take the eval report: ${answer.error}`);
  return answer.ok ? (answer.ts ?? null) : null;
}

/**
 * Posts every eval that did not pass to a Slack channel: one message for the run, and one reply under it for each
 * eval, with the shopper's words and each check that failed. A run where everything passed posts nothing.
 *
 * Reads `SLACK_BOT_TOKEN` and `SLACK_EVALS_CHANNEL` (a channel id). Without both it reports nothing, so a local run
 * stays quiet.
 */
export function slackReporter(): EvalReporter {
  const failures: Failure[] = [];
  return {
    onRunStart() {},
    onEvalComplete(result: EveEvalResult, context?: EveEvalCompleteContext) {
      if (result.verdict === "passed" || result.verdict === "skipped") return;
      const missed = result.assertions.filter((assertion) => assertion.errored || assertion.passed === false);
      const ask = context?.evaluation.metadata?.ask;
      failures.push({
        title: context?.evaluation.description ?? result.id,
        ask: typeof ask === "string" ? ask : null,
        reply: result.result.reply ?? null,
        verdict: result.verdict,
        lines: [
          ...(result.error ? [`the run broke: ${result.error}`] : []),
          ...missed.map((assertion) => {
            const score = assertion.score === undefined ? "" : ` (scored ${assertion.score.toFixed(2)}, needs ${assertion.threshold ?? 1})`;
            return `${assertion.key ?? assertion.name}${score}${assertion.message ? `: ${assertion.message}` : ""}`;
          }),
        ],
      });
    },
    async onRunComplete(summary: EveEvalRunSummary) {
      if (failures.length === 0) return;
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_EVALS_CHANNEL;
      if (!token || !channel) {
        console.error("Set SLACK_BOT_TOKEN and SLACK_EVALS_CHANNEL to send failed evals to Slack.");
        return;
      }
      const total = summary.results.length;
      const run = process.env.GITHUB_RUN_ID
        ? ` <${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}|See the run>`
        : "";
      const thread = await post(token, {
        channel,
        text: `:rotating_light: Buy evals: ${failures.length} of ${total} did not pass (${summary.failed} failed, ${summary.scored} scored low).${run}`,
      });
      if (!thread) return;
      for (const failure of failures) {
        const kind = failure.verdict === "scored" ? "scored low" : "failed";
        const ask = failure.ask ? `\nShopper typed: _${plain(failure.ask)}_` : "";
        const reply = failure.reply ? `\nThe agent's last reply: _${plain(failure.reply.slice(0, 300))}_` : "";
        const lines = failure.lines.map((line) => `• ${plain(line.slice(0, 600))}`).join("\n");
        await post(token, { channel, thread_ts: thread, text: `*${plain(failure.title)}* ${kind}${ask}${reply}\n${lines}`.slice(0, 3500) });
      }
    },
  };
}
