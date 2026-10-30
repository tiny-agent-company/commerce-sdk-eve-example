import { AgentcardClient, BUY_TOOL_DESCRIPTION, buyTool, buyToolDefinition } from "@agent-cards/commerce-sdk";
import type { BuyToolLink, BuyToolResult } from "@agent-cards/commerce-sdk";
import { defineTool } from "eve/tools";

const agentcard = new AgentcardClient({
  clientId: process.env.AGENTCARD_CLIENT_ID ?? "",
  clientSecret: process.env.AGENTCARD_CLIENT_SECRET ?? "",
});

/** One buy tool per shopper and chat, kept so each chat holds its own cart. */
const shoppers = new Map<string, ReturnType<typeof buyTool>>();

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
    const text = await run;
    yield snapshot();
    yield text;
  },
});
