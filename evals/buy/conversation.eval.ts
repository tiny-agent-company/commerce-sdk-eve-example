import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { buyCalls, checkAnswer, checkTurn, lastAnswer, type Card } from "../lib/buy.js";

/**
 * Chats of more than one message: a shopper narrows, changes their mind, or picks a product. A follow-up may be
 * answered with a new search or from the cards already in the chat; either way the answer is graded against the ask.
 */
export default [
  defineEval({
    description: "conversation: narrow the search",
    tags: ["conversation"],
    metadata: { ask: "a backpack → a waterproof one for hiking, under $50" },
    async test(t) {
      const first = await t.send("a backpack");
      first.calledTool("buy");
      const shown = await checkAnswer(t, first, { ask: "a backpack", wants: [{ what: "backpack", must: ["a backpack"] }] });

      const second = await first.session.send("a waterproof one for hiking, under $50");
      t.succeeded();
      await checkAnswer(
        t,
        second,
        {
          ask: "First message: a backpack. Second message: a waterproof one for hiking, under $50",
          // A new search must stay inside the budget. An answer from the earlier cards is judged on the one it recommends.
          maxPrice: buyCalls(second).length > 0 ? 50 : undefined,
          wants: [{ what: "waterproof hiking backpack", must: ["a backpack", "for hiking", "waterproof or water resistant, or comes with a rain cover", "costs under $50"] }],
        },
        shown,
      );
    },
  }),

  defineEval({
    description: "conversation: change to a different product",
    tags: ["conversation"],
    metadata: { ask: "a desk lamp → actually forget the lamp, I need an anti-fatigue standing desk mat instead" },
    async test(t) {
      const first = await t.send("a desk lamp");
      first.calledTool("buy");
      await checkAnswer(t, first, { ask: "a desk lamp", wants: [{ what: "desk lamp", must: ["a lamp for a desk"] }] });

      const second = await first.session.send("actually forget the lamp, I need an anti-fatigue standing desk mat instead");
      t.succeeded();
      second.calledTool("buy");
      await checkAnswer(t, second, {
        ask: "First message: a desk lamp. Second message: actually forget the lamp, I need an anti-fatigue standing desk mat instead",
        wants: [{ what: "anti-fatigue standing mat", must: ["a floor mat to stand on", "anti-fatigue or made for a standing desk"] }],
      });
    },
  }),

  defineEval({
    description: "conversation: pick a product, and no order is placed without a yes",
    tags: ["conversation"],
    metadata: { ask: "AA batteries from Amazon → the first one" },
    async test(t) {
      const first = await t.send("AA batteries from Amazon");
      first.calledTool("buy");
      const shown = await checkAnswer(t, first, { ask: "AA batteries from Amazon", store: /amazon/i, wants: [{ what: "AA batteries", must: ["batteries", "AA size"] }] });
      await t.require(shown, satisfies((cards: Card[]) => cards.length > 0, "the search showed a product to pick"));

      const second = await first.session.send("the first one");
      t.succeeded();
      second.calledTool("buy");
      checkTurn(t, second);
      const ids = new Set(shown.map((card) => card.id));
      t.check(
        buyCalls(second),
        satisfies((calls: ReturnType<typeof buyCalls>) => calls.some((call) => ids.has(call.input.product_id as string)), "the pick names a product from the chat's cards, by its id"),
      ).label("picks-a-shown-product");
      const answer = lastAnswer(second);
      t.check(
        answer?.status,
        satisfies((status: string | undefined) => status === "needs_input" || status === "needs_card", "the shopper is asked something or to save a card, and nothing is ordered"),
      ).label("asks-before-ordering");
      const cart = answer?.cart;
      if (cart) {
        t.check(
          cart.items,
          satisfies((items: { name: string }[]) => items.length === 1 && /\bAA\b|batter/i.test(items[0]!.name), `the cart holds one line, AA batteries (it holds: ${cart.items.map((item) => `${item.qty} x ${item.name}`).join("; ")})`),
        ).label("cart-holds-the-pick");
        t.check(cart.store, satisfies((store: string) => /amazon/i.test(store), `the cart is at Amazon (it is at ${cart.store})`)).label("cart-at-named-store");
      }
    },
  }),

  defineEval({
    description: "conversation: a greeting gets an answer and no cart",
    tags: ["conversation"],
    metadata: { ask: "hi! what can you do?" },
    async test(t) {
      const turn = await t.send("hi! what can you do?");
      t.succeeded();
      checkTurn(t, turn);
      t.check(lastAnswer(turn)?.cart ?? null, satisfies((cart: unknown) => cart === null, "a greeting builds no cart")).label("no-cart");
    },
  }),
];
