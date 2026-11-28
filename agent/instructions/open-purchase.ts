import { defineDynamic, defineInstructions } from "eve/instructions";
import { purchaseOpenFor, shopperKey } from "../tools/buy.js";

/**
 * While a purchase is open with Agentcard, every message of the shopper goes to the buy tool before the model writes
 * anything: the shopper is answering what Agentcard asked, such as an address or a size, and only Agentcard can take it.
 *
 * eve runs the model, and the buy tool runs only when the model calls it, so no code of this app runs before the model on
 * every message. This instruction is computed before each model call instead (Commerce SDK 0.35.0 `buy.purchaseOpen`). It
 * says "if you have not called the buy tool yet" because it is also there for the model call after the tool's answer in
 * the same turn, where it must not cause a second call. Not memoized: the purchase opens and closes during the chat.
 *
 * The open purchase is read from this process's memory. In local development and the evals one process runs the whole
 * chat. A deployment whose model calls run in other processes needs `buyTool({ state })` and `await buy.load()` first.
 */
export default defineDynamic((ctx) =>
  purchaseOpenFor(shopperKey(ctx.session.auth.current, ctx.session.id))
    ? defineInstructions({
        content:
          "A purchase is open with Agentcard. If you have not called the buy tool for the shopper's latest message yet, call it now with that message, before you write anything. Do not answer the shopper yourself, and do not ask for anything Agentcard did not ask for.",
      })
    : null,
);
