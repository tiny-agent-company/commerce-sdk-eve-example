import { transcriptOf } from "eve/client";
import type { EveEvalResult } from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";

/** One eval that did not pass: its conversation, word for word, and the reasons its checks gave. */
interface Failure {
  messages: { role: "user" | "assistant"; text: string }[];
  reasons: string[];
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

async function post(token: string, body: Record<string, unknown>): Promise<string | null> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ unfurl_links: false, unfurl_media: false, ...body }),
  });
  const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (!answer.ok) console.error(`Slack did not take the eval report: ${answer.error}`);
  return answer.ok ? (answer.ts ?? null) : null;
}

/**
 * The eval's conversation, word for word: each message sent to the agent and each reply it gave, in order. The
 * agent's replies within one turn are joined into one.
 */
function conversationOf(result: EveEvalResult): Failure["messages"] {
  const events = result.result.sessions?.[0]?.events ?? result.result.events;
  const messages: Failure["messages"] = [];
  for (const message of transcriptOf(events).messages) {
    const last = messages.at(-1);
    if (last && last.role === message.role) last.text = `${last.text}\n\n${message.text}`;
    else messages.push({ role: message.role, text: message.text });
  }
  return messages;
}

/**
 * Posts every eval that did not pass to a Slack channel, as its conversation:
 * - the post is the first message sent to the agent, word for word;
 * - its thread holds the agent's reply, then each next message and reply, word for word;
 * - the last reply in the thread says why the eval failed, one line per failed check.
 * A run where everything passed posts nothing. A run posts at most 25 evals.
 *
 * Reads `SLACK_BOT_TOKEN` and `SLACK_EVALS_CHANNEL` (a channel id). Without both it reports nothing, so a local run
 * stays quiet.
 */
export function slackReporter(): EvalReporter {
  const failures: Failure[] = [];
  return {
    onRunStart() {},
    onEvalComplete(result: EveEvalResult) {
      if (result.verdict === "passed" || result.verdict === "skipped") return;
      const missed = result.assertions.filter((assertion) => assertion.errored || assertion.passed === false);
      failures.push({
        messages: conversationOf(result),
        reasons: [
          ...(result.error ? [`The run broke: ${result.error}`] : []),
          ...missed.map((assertion) => assertion.message ?? assertion.key ?? assertion.name),
        ],
      });
    },
    async onRunComplete() {
      if (failures.length === 0) return;
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_EVALS_CHANNEL;
      if (!token || !channel) {
        console.error("Set SLACK_BOT_TOKEN and SLACK_EVALS_CHANNEL to send failed evals to Slack.");
        return;
      }
      for (const failure of failures.slice(0, MOST_POSTED)) {
        const [first, ...rest] = failure.messages;
        const opener = first?.role === "user";
        const thread = await post(token, { channel, text: quoted("Message sent to the agent:", opener ? first.text : "(no message was sent)") });
        if (!thread) continue;
        for (const message of opener ? rest : failure.messages) {
          await post(token, { channel, thread_ts: thread, text: quoted(message.role === "user" ? "Message sent to the agent:" : "Agent's reply:", message.text) });
        }
        const reasons = failure.reasons.map((reason) => `• ${plain(reason.slice(0, 1200))}`).join("\n");
        await post(token, { channel, thread_ts: thread, text: `*Why the eval failed:*\n${reasons}`.slice(0, 3500) });
      }
    },
  };
}
