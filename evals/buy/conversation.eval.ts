import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { buyCalls, checkSearch, checkTurn, type BuyAnswer } from "../lib/buy.js";

/** Searches that take more than one message: a shopper narrows, changes their mind, or picks a product. */
export default [
  defineEval({
    description: "conversation: narrow the search",
    tags: ["conversation"],
    metadata: { ask: "a backpack → a waterproof one for hiking, under $50" },
    async test(t) {
      const first = await t.send("a backpack");
      checkSearch(t, first, { ask: "a backpack", match: /backpack|pack|bag/i });

      const second = await first.session.send("a waterproof one for hiking, under $50");
      t.succeeded();
      checkSearch(t, second, { ask: "a waterproof hiking backpack under $50", match: /backpack|pack|bag/i, maxPrice: 50 });
    },
  }),

  defineEval({
    description: "conversation: change to a different product",
    tags: ["conversation"],
    metadata: { ask: "a desk lamp → actually, a standing desk mat instead" },
    async test(t) {
      const first = await t.send("a desk lamp");
      checkSearch(t, first, { ask: "a desk lamp", match: /lamp|light/i });

      const second = await first.session.send("actually forget the lamp, I need an anti-fatigue standing desk mat instead");
      t.succeeded();
      checkSearch(t, second, { ask: "an anti-fatigue standing desk mat", match: /mat/i });
    },
  }),

  defineEval({
    description: "conversation: pick a product, and no order is placed without a yes",
    tags: ["conversation"],
    metadata: { ask: "AA batteries from Amazon → the first one" },
    async test(t) {
      const first = await t.send("AA batteries from Amazon");
      const shown = checkSearch(t, first, { ask: "AA batteries from Amazon", match: /\bAA\b|batter/i, store: /amazon/i });
      await t.require(shown?.products ?? [], satisfies((products: BuyAnswer["products"]) => products.length > 0, "the search showed a product to pick"));

      const second = await first.session.send("the first one");
      t.succeeded();
      const picked = checkTurn(t, second);
      t.check(
        buyCalls(second),
        satisfies((calls: ReturnType<typeof buyCalls>) => calls.some((call) => shown!.products.some((product) => product.product_id === call.input.product_id)), "the pick names a product the search showed, by its id"),
      ).label("picks-by-id");
      t.check(
        picked?.status,
        satisfies((status: string | undefined) => status === "needs_input" || status === "needs_card", "the shopper is asked to confirm, or to save a card first"),
      ).label("asks-before-ordering");
    },
  }),

  defineEval({
    description: "conversation: a greeting starts no search",
    tags: ["conversation"],
    metadata: { ask: "hi! what can you do?" },
    async test(t) {
      await t.send("hi! what can you do?");
      t.succeeded();
      t.notCalledTool("buy");
    },
  }),
];
