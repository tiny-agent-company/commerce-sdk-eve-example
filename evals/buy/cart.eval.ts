import { defineEval } from "eve/evals";
import { cartStep, checkCart, checkNothingOrdered, checkReached, logPath, sandboxCredentials, shop } from "../lib/purchase.js";
import { STORES, SUPPLIERS } from "../lib/stores.js";

/**
 * Can a product be put in the cart? One eval per store and per supplier that can serve it (lib/stores.ts).
 *
 * Each eval is a short chat. The shopper asks for one specific, cheap product at the store, picks one of the cards
 * shown, and stops as soon as the product is in a cart. At a store Agentcard orders from through its retail supplier
 * that is right after the pick. At a store that sells on its own website the cart only exists once that store's own
 * checkout has priced it, so the shopper first gives a delivery address and guest details. All of those are
 * placeholders (lib/purchase.ts): never a real address or a real person.
 *
 * An eval passes when, by fixed rules and no judge model:
 * - a cart exists, at the store the shopper named;
 * - it holds exactly the picked product, one of it;
 * - the line shows a price, and the total adds up from the items and the fees, or is marked an estimate when the store
 *   has not priced it yet;
 * - nothing was ordered: no turn placed or started an order.
 *
 * For a booking (a flight, a room, a car, a table, a class, a ticket) the "cart" is the booking held with its price.
 *
 * The evals run with sandbox (test mode) credentials only, and skip themselves otherwise. A store that is down, or a
 * supplier that shows no card for the store, fails that one eval with the reason; it never breaks the run.
 */
export default STORES.map((row) =>
  defineEval({
    description: `cart: ${row.store}, through the ${SUPPLIERS[row.supplier]}`,
    tags: ["cart", row.kind],
    metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
    // A store's own checkout can take a few minutes to price a cart.
    timeoutMs: 720_000,
    async test(t) {
      if (row.skip) t.skip(row.skip);
      if (!(await sandboxCredentials())) t.skip("The cart evals run with sandbox (test mode) credentials only.");

      const purchase = await shop(t, row, "cart");
      t.succeeded();
      checkNothingOrdered(t, purchase);
      const step = cartStep(purchase);
      // A chat that ended on a payment page or a sign-in with no cart to show never put the product in one.
      if (!step && !purchase.stopped) purchase.stopped = `the shopper was handed a ${purchase.handed ?? "next"} step before any cart was shown. Agentcard said: ${(purchase.steps.at(-1)?.answer?.reply ?? "").replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").slice(0, 220)}`;
      if (!checkReached(t, purchase, "product-in-cart", "the product gets into a cart") || !step) return;
      logPath(t, row, step.snapshot?.carts.at(-1)?.merchant);
      checkCart(t, row, purchase, step);
    },
  }),
);
