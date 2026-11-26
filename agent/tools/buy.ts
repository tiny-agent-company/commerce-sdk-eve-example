import { AgentcardClient, BUY_TOOL_DESCRIPTION, buyTool, buyToolDefinition } from "@agent-cards/commerce-sdk";
import type { BuyToolLink, BuyToolResult } from "@agent-cards/commerce-sdk";
import { defineTool } from "eve/tools";
import { recordBuy, type BuyRecord } from "../lib/agnost.js";
import { askToSend } from "../lib/shopper-words.js";

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

    // The shopper's message goes to Agentcard as they typed it, read from the chat, whatever words the model put in `ask`
    // (lib/shopper-words.ts). The model's `confirm`, `new_order`, `product_id`, `store_id` and `more` stay as it set them.
    const ask = askToSend(ctx.messages, String(input.ask ?? ""));
    const call = { ...input, ask };

    // Agnost AI keeps a record of the call when AGNOST_ORG_ID is set: the shopper's words now, the answer once it is in.
    const record = recordBuy({ shopperId: externalUserId, conversationId: ctx.session.id, ask });

    // The links and carts reach the chat as progress snapshots; the model only reads the final result.
    const links: BuyToolLink[] = [];
    // Products a search found past the cards it showed, which an app reveals on "show more".
    let more: BuyToolLink[] = [];
    let results: BuyToolResult[] = [];
    let changed = () => {};
    const turn = buy.turn(ask, {
      onReaction: () => {},
      onItem: (item) => {
        if (item.kind === "link") links.push(item.link);
        changed();
      },
      onFound: (found) => {
        more = found.more;
        changed();
      },
      onResult: (result) => {
        results = [...results, result];
        changed();
      },
    });
    // `ask` is the words this call sent, which the evals read to check the shopper's words arrived unchanged.
    const snapshot = () => ({ ask, links: [...links], more: [...more], carts: results.at(-1)?.carts ?? [], status: results.at(-1)?.status ?? null });

    let done = false;
    const run = turn.handle(call).finally(() => {
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
