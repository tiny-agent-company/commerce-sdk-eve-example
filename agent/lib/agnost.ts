import { createHash } from "node:crypto";
import * as agnost from "agnostai";

/**
 * Sends each buy conversation to Agnost AI (https://agnost.ai), which shows what shoppers ask and what they get back.
 * It runs only when `AGNOST_ORG_ID` is set, the organization id from Agnost's settings page, so a project without one
 * sends nothing.
 *
 * Agnost receives the shopper's words and Agentcard's reply with every link taken out. The shopper is named by a hash
 * of their id, never the id itself.
 */
const orgId = process.env.AGNOST_ORG_ID;
const on = Boolean(orgId) && agnost.init(orgId as string, { debug: process.env.AGNOST_DEBUG === "1" });

/** What one buy call reports once it has an answer: the reply as the model read it, and a few facts to filter by. */
export interface BuyRecord {
  reply: string;
  ok: boolean;
  facts: Record<string, string | number | boolean | null>;
}

/**
 * Starts the record of one buy call and returns the function that finishes it. `conversationId` groups a chat's calls
 * into one conversation in Agnost. Finishing waits at most two seconds for Agnost, so a slow Agnost never holds up a
 * shopper.
 */
export function recordBuy(call: { shopperId: string; conversationId: string; ask: string }): (record: BuyRecord) => Promise<void> {
  if (!on) return async () => {};
  const interaction = agnost.begin({
    userId: createHash("sha256").update(call.shopperId).digest("hex").slice(0, 16),
    agentName: "buy",
    conversationId: call.conversationId,
    input: call.ask,
  });
  return async ({ reply, ok, facts }) => {
    if (!interaction || interaction.isFinished) return;
    interaction.setProperties(facts);
    interaction.end(reply, ok);
    await Promise.race([agnost.flush(), new Promise((resolve) => setTimeout(resolve, 2_000))]).catch(() => {});
  };
}
