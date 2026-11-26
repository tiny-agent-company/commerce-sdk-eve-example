import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { cartStep, checkCart, checkFieldsAgreeWithReply, checkNothingOrdered, checkReached, checkTotalNeverMovesSilently, logPath, readyForTheYes, sandboxCredentials, sayYes, shop, stillPricing } from "../lib/purchase.js";
import { STORES, SUPPLIERS } from "../lib/stores.js";

/**
 * Does a purchase get as far as the checkout step? One eval per store and per supplier that can serve it
 * (lib/stores.ts), the same rows as buy/cart.eval.ts.
 *
 * WHAT "GOT TO THE CHECKOUT STEP" MEANS HERE
 *
 * It is the last step before money can move, and no further:
 *
 * 1. Ready to pay. The shopper has picked a product and given everything the checkout asks for (a delivery address, a
 *    name, an email, a phone number), and Agentcard shows the final cart and asks for the yes that pays. At a store that
 *    sells on its own website this is the store's real checkout page: Agentcard's browser has filled it in up to the
 *    payment form and read the store's own total, tax and shipping included. At a store Agentcard orders from through
 *    its retail supplier, the total is an estimate until the order goes in, and the cart says so.
 * 2. The yes is stopped at the payment. For goods only, the shopper then says yes, and the answer must be the payment
 *    step and nothing past it. A retailer may first price the order's tax and shipping, which takes a moment: the
 *    shopper waits and says yes again, for about six minutes at most, and a changed total must be named in the reply. In the sandbox that is a refusal that says test mode cannot pay
 *    (`sandbox_mode`), or that the shopper has no test card (`test_card_missing`, with the cart still held at the
 *    store's payment form). With a saved card it would be the approval page (`approval_sent`, an `approval` link), and
 *    for a new live shopper the page to save a card (`needs_card`, a `vault` link); both count. `placing` and
 *    `order_placed` never do.
 *
 * WHY THIS IS SAFE
 *
 * - The evals run with sandbox (test mode) credentials only, and skip themselves otherwise. Agentcard refuses every
 *   sandbox payment before it reserves money, makes a card or calls a store.
 * - Each chat is a new shopper with no saved card, and no eval ever opens a page to save or approve one.
 * - Every detail the shopper gives is a placeholder (lib/purchase.ts): a public landmark, a stand-in name, an email on a
 *   domain reserved for examples, a phone number from the range reserved for fiction.
 * - A purchase that needs the shopper's own account stops at the sign-in. Food delivery prices the delivery on the
 *   shopper's own delivery account, and a few stores only check out signed in. An eval has no such account and must not
 *   use a real one, so there "got to the checkout step" means: the cart is right and the shopper is handed that sign-in
 *   page (`next_action: store_login`, a `store_login` link). A store that asks for the sign-in before it builds any
 *   cart fails, with that as the reason.
 * - A store that prices its tax only once a card is in hands over the approval page before the final total. Being
 *   handed that page counts as the payment step, and the eval stops there without opening it.
 * - A booking stops at step 1. No eval says yes to a flight, a room, a car, a table, a class or a ticket: a table is
 *   free to book, so only Agentcard's sandbox would stand between a yes and a real table held in a stranger's name.
 *
 * An eval passes when, by fixed rules and no judge model: the purchase reached step 1 with the cart still holding
 * exactly the picked product at the named store; the total never changed between two answers without the reply naming
 * the new total; for goods and food the yes was answered by the payment step; and nothing was ordered or started.
 */
const PAYMENT_STOPS = ["sandbox_mode", "test_card_missing"];

export default STORES.map((row) =>
  defineEval({
    description: `checkout: ${row.store}, through the ${SUPPLIERS[row.supplier]}`,
    tags: ["checkout", row.kind],
    metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
    // A store's own checkout can take a few minutes to price a cart, and a retailer a few more to price the yes.
    timeoutMs: 1_200_000,
    async test(t) {
      if (row.skip) t.skip(row.skip);
      if (row.skipCheckout) t.skip(row.skipCheckout);
      if (!(await sandboxCredentials())) t.skip("The checkout evals run with sandbox (test mode) credentials only, where no yes can place an order.");

      const purchase = await shop(t, row, "checkout");
      t.succeeded();
      if (!checkReached(t, purchase, "ready-to-pay", "the purchase gets to the final cart and the ask for a yes")) {
        checkNothingOrdered(t, purchase);
        return;
      }
      const ready = cartStep(purchase);
      const last = purchase.steps.at(-1)!;
      if (ready) {
        logPath(t, row, ready.snapshot?.carts.at(-1)?.merchant);
        checkCart(t, row, purchase, ready);
      }

      if (purchase.handed === "sign-in") {
        // The store, or the delivery service, wants the shopper's own account next. The cart is built; the eval stops here.
        const links = last.answer?.links_sent ?? [];
        t.check(links, satisfies((sent: string[]) => sent.includes("store_login"), `the shopper is handed the sign-in page of their own account (links sent: ${links.join(", ") || "none"})`)).label("handed-the-sign-in");
        t.log("stopped at the sign-in: no eval signs in to a store or delivery account");
      } else if (purchase.handed === "payment") {
        // Some stores price the tax only once a card is in, so the approval page comes before the final total.
        t.log(`stopped at the payment page the shopper was handed (${last.answer?.status}): no eval opens it`);
      } else if (!ready) {
        t.check(null, satisfies(() => false, "the purchase is ready to pay with a cart to show for it")).label("ready-to-pay");
      } else if (row.kind === "booking") {
        checkFieldsAgreeWithReply(t, ready);
        t.log("stopped before the yes: no eval confirms a booking");
      } else {
        checkFieldsAgreeWithReply(t, ready);
        // The yes. A store may answer one with its newly priced total and ask again, and a store that is still pricing
        // the order's tax and shipping can take several minutes to send its total, so the shopper waits half a minute
        // and says yes again: about six minutes of waiting at most.
        let step = await sayYes(t, purchase);
        for (let again = 0; again < 12 && step && step.answer?.status === "needs_input"; again++) {
          if (stillPricing(step.answer)) await t.sleep(30_000);
          else if (readyForTheYes(step.answer)) checkFieldsAgreeWithReply(t, step);
          else break;
          step = await sayYes(t, purchase, "yes, place the order");
        }
        if (checkReached(t, purchase, "yes-answered", "the yes gets an answer") && step) {
          const status = step.answer?.status ?? "no answer";
          const stop = step.snapshot?.decline_code ?? null;
          const links = step.answer?.links_sent ?? [];
          const atPayment = (status === "declined" && stop !== null && PAYMENT_STOPS.includes(stop)) || (status === "needs_card" && links.includes("vault")) || (status === "approval_sent" && links.includes("approval"));
          t.check(atPayment, satisfies((reached: boolean) => reached, `the yes is stopped at the payment step (status ${status}, reason ${stop ?? "none"}, links ${links.join(", ") || "none"}; Agentcard said: ${(step.answer?.reply ?? "").replace(/\s+/g, " ").slice(0, 240)})`)).label("stopped-at-payment");
        }
      }
      checkTotalNeverMovesSilently(t, purchase);
      checkNothingOrdered(t, purchase);
    },
  }),
);
