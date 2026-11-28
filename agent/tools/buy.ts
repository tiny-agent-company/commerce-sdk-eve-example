import { AgentcardClient, BUY_TOOL_DESCRIPTION, buyTool, buyToolDefinition } from "@agent-cards/commerce-sdk";
import type { BuyToolLink, BuyToolResult } from "@agent-cards/commerce-sdk";
import { defineTool } from "eve/tools";
import { recordBuy, type BuyRecord } from "../lib/agnost.js";
import { cardDates } from "../lib/card-dates.js";
import { askToSend } from "../lib/shopper-words.js";

const agentcard = new AgentcardClient({
  clientId: process.env.AGENTCARD_CLIENT_ID ?? "",
  clientSecret: process.env.AGENTCARD_CLIENT_SECRET ?? "",
});

/** One buy tool per shopper and chat, kept so each chat holds its own cart. */
const shoppers = new Map<string, ReturnType<typeof buyTool>>();

/**
 * The shopper of a chat. The signed-in user is the shopper. Without auth, each session is its own shopper. Local
 * development and the evals sign every session in as the same stand-in user, who is nobody: there too each session is its
 * own shopper, so two chats never share a cart. The one exception is an eval run that signs in to a store with a test
 * account: it sets EVAL_SHOPPER_ID, and every local session is then that one test shopper, who has the account saved with
 * Agentcard (evals/lib/store-accounts.ts). It is never a real person, and a signed-in user is never replaced by it.
 */
export function shopperOf(user: { principalType: string; principalId: string } | null | undefined, sessionId: string): string {
  return user && user.principalType !== "local-dev" ? user.principalId : process.env.EVAL_SHOPPER_ID || `session:${sessionId}`;
}

/** The key of a chat's buy tool: its shopper and its session. The tool and the open-purchase instruction build it the same way. */
export const shopperKey = (user: { principalType: string; principalId: string } | null | undefined, sessionId: string) => `${shopperOf(user, sessionId)}:${sessionId}`;

/** True while this chat's purchase is open with Agentcard (`buy.purchaseOpen`). False before the chat's first buy call. */
export const purchaseOpenFor = (key: string) => shoppers.get(key)?.purchaseOpen === true;

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
    const user = ctx.session.auth.current;
    const externalUserId = shopperOf(user, ctx.session.id);
    const key = shopperKey(user, ctx.session.id);
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
    // Beside the carts, a snapshot says where the purchase stands, for an app to draw: the step the shopper takes next, why a
    // purchase stopped, and the order's id once there is one. None of them holds a link. `ask` is the words this call sent,
    // which the evals read to check the shopper's words arrived unchanged. `card_dates` is when each card's booking starts,
    // by the card's id, for a flight or a table (lib/card-dates.ts). `turn_continues` is true when the call answered while
    // Agentcard still worked on the request: the result arrives later, so an app shows that it is still working.
    const snapshot = () => {
      const last = results.at(-1);
      return {
        ask,
        links: [...links],
        more: [...more],
        carts: last?.carts ?? [],
        status: last?.status ?? null,
        next_action: last?.next_action ?? null,
        decline_code: last?.decline_code ?? null,
        error_code: last?.error_code ?? null,
        order_id: last?.order_id ?? null,
        card_dates: cardDates(last?.products, last?.envelope),
        turn_continues: last?.turn_continues === true,
      };
    };

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
