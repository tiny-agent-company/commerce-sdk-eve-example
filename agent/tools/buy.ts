import { AgentcardClient, BUY_TOOL_DESCRIPTION, buyTool, buyToolDefinition } from "@agent-cards/commerce-sdk";
import type { BuyToolLink, BuyToolResult } from "@agent-cards/commerce-sdk";
import { defineTool } from "eve/tools";
import { recordBuy, type BuyRecord } from "../lib/agnost.js";

const agentcard = new AgentcardClient({
  clientId: process.env.AGENTCARD_CLIENT_ID ?? "",
  clientSecret: process.env.AGENTCARD_CLIENT_SECRET ?? "",
});

/** One buy tool per shopper and chat, kept so each chat holds its own cart. */
const shoppers = new Map<string, ReturnType<typeof buyTool>>();

/** The answer the model read, which holds no link, as the record Agnost keeps of it. */
function forAgnost(text: string, confirm: boolean): BuyRecord {
  try {
    const answer = JSON.parse(text) as { status?: string; reply?: string; products?: { name: string }[]; cart?: { store: string; total: string } | null };
    return {
      reply: answer.reply ?? text,
      ok: answer.status !== "declined",
      facts: {
        status: answer.status ?? null,
        confirm,
        products_shown: answer.products?.length ?? 0,
        products: (answer.products ?? []).map((product) => product.name).join(" | ").slice(0, 1500),
        cart_store: answer.cart?.store ?? null,
        cart_total: answer.cart?.total ?? null,
      },
    };
  } catch {
    return { reply: text, ok: true, facts: { status: null, confirm } };
  }
}

export default defineTool({
  description: BUY_TOOL_DESCRIPTION,
  inputSchema: buyToolDefinition().input_schema,
  label: { start: ({ ask }) => `Buy: ${ask}` },
  async *execute(input, ctx) {
    // The signed-in user is the shopper. Without auth, each session is its own shopper.
    const externalUserId = ctx.session.auth.current?.principalId ?? `session:${ctx.session.id}`;
    const key = `${externalUserId}:${ctx.session.id}`;
    let buy = shoppers.get(key);
    if (!buy) {
      buy = buyTool({ agentcard, externalUserId, threadId: ctx.session.id });
      shoppers.set(key, buy);
    }

    // Agnost AI keeps a record of the call when AGNOST_ORG_ID is set: the shopper's words now, the answer once it is in.
    const record = recordBuy({ shopperId: externalUserId, conversationId: ctx.session.id, ask: input.ask as string });

    // The links and carts reach the chat as progress snapshots; the model only reads the final result.
    const links: BuyToolLink[] = [];
    let results: BuyToolResult[] = [];
    let changed = () => {};
    const turn = buy.turn(input.ask as string, {
      onReaction: () => {},
      onItem: (item) => {
        if (item.kind === "link") links.push(item.link);
        changed();
      },
      onResult: (result) => {
        results = [...results, result];
        changed();
      },
    });
    const snapshot = () => ({ links: [...links], carts: results.at(-1)?.carts ?? [], status: results.at(-1)?.status ?? null });

    let done = false;
    const run = turn.handle(input).finally(() => {
      done = true;
      changed();
    });
    run.catch(() => {});
    while (!done) {
      await new Promise<void>((resolve) => (changed = resolve));
      if (!done) yield snapshot();
    }
    let text: string;
    try {
      text = await run;
    } catch (error) {
      await record({ reply: error instanceof Error ? error.message : String(error), ok: false, facts: { status: "error", confirm: input.confirm === true } });
      throw error;
    }
    await record(forAgnost(text, input.confirm === true));
    yield snapshot();
    yield text;
  },
});
