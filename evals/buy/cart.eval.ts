import { defineEval } from "eve/evals";
import { chatAgainOnce } from "../lib/connection.ts";
import { limitFor, oneAfterAnother } from "../lib/one-after-another.ts";
import { cartStep, checkCart, checkChat, checkReached, endedElsewhere, logPath, sandboxCredentials, shop } from "../lib/purchase.js";
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
 * - it holds exactly the picked product, one of it, in the size and the colour the shopper asked for;
 * - the line shows a price, that price times the quantity is the store's subtotal, and the total adds up from the items
 *   and the fees, or is marked an estimate when the store has not priced it yet;
 * - no approval or payment step came before the cart, no reply asked for something the shopper had already said, and a
 *   reply that asks for a yes agrees with the answer's fields and quotes the cart's total;
 * - nothing was ordered: no turn placed or started an order.
 *
 * For a booking (a flight, a room, a car, a table, a class, a ticket) the "cart" is the booking held with its price, and
 * every card shown and the booking itself must be for the days the shopper asked for.
 *
 * A shopper who picked a card the store does not sell in the colour or the size they asked for picks another card that
 * fits, as a person would, and the eval fails only when none does.
 *
 * An eval can also end as something that is neither a pass nor a failure of Agentcard's, each reported as its own kind
 * (lib/outcome.ts): the store's own answer (out of stock, another price than the card's, no seats, or its own account
 * needed, asked for first, with no test account there to sign in with), a mistake of the example chat app, or a
 * connection that broke in two chats running (a chat whose connection breaks runs once more, lib/connection.ts).
 *
 * The evals run with sandbox (test mode) credentials only, and skip themselves otherwise. A store that is down, or a
 * supplier that shows no card for the store, fails that one eval with the reason; it never breaks the run. The daily
 * run sends each eval three times, one run after another (lib/one-after-another.ts), and reports how many of the three
 * passed.
 */

/** How long one run of a cart eval may take: a store's own checkout can take a few minutes to price a cart, and a late result a few more to arrive. */
const RUN_LIMIT_MS = 1_200_000;

export default STORES.map((row) => {
  const description = `cart: ${row.store}, through the ${SUPPLIERS[row.supplier]}`;
  return defineEval({
    description,
    tags: ["cart", row.kind],
    metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
    // Each run of this eval waits for the one before it (lib/one-after-another.ts), so its limit covers theirs too.
    timeoutMs: limitFor(RUN_LIMIT_MS),
    async test(t) {
      if (row.skip) t.skip(row.skip);
      if (!(await sandboxCredentials())) t.skip("The cart evals run with sandbox (test mode) credentials only.");

      const purchase = await oneAfterAnother(description, RUN_LIMIT_MS, () => chatAgainOnce(() => shop(t, row, "cart"), (line) => t.log(line)));
      t.succeeded();
      const step = cartStep(purchase);
      // A chat that ended on a payment page with no cart to show never put the product in one. That is told once, by
      // the check every chat gets for it (cart-before-approval), so it is not also reported here in other words.
      const paymentFirst = !step && !purchase.stopped && purchase.handed === "payment";
      if (!endedElsewhere(purchase) && !paymentFirst) {
        if (!step && !purchase.stopped) purchase.stopped = `the chat ended with no cart shown. Agentcard said: ${(purchase.steps.at(-1)?.answer?.reply ?? "").replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").slice(0, 220)}`;
        if (checkReached(t, purchase, "product-in-cart", "the product gets into a cart") && step) {
          logPath(t, row, step.snapshot?.carts.at(-1)?.merchant);
          checkCart(t, row, purchase, step);
        }
      }
      checkChat(t, row, purchase);
    },
  });
});
