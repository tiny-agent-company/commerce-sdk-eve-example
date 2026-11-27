import { defineEval, type EveEvalContext } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { cartStep, checkCart, checkChat, checkReached, checkTotalNeverMovesSilently, endedElsewhere, logPath, readyForTheYes, sandboxCredentials, shop, stillPricing, type Purchase } from "../lib/purchase.js";
import { storeAnswerOf } from "../lib/store-answer.ts";
import { STORES, SUPPLIERS, type StoreCase } from "../lib/stores.js";

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
 *    shopper waits and asks for an update every half minute, for about ten minutes at most, and says yes again only to
 *    a newly priced total, which the reply must name. In the sandbox that is a refusal that says test mode cannot pay
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
 *   cart is the store's own answer when the sign-in came first, before any other question, with another store offered
 *   as the alternative. A sign-in asked for after other questions is a failure: the shopper answered them for nothing.
 * - A store that prices its tax only once a card is in hands over the approval page before the final total. Being
 *   handed that page counts as the payment step, and the eval stops there without opening it. The cart must have been
 *   shown first: an approval asked for before any cart is a failure.
 * - A booking stops at step 1. No eval says yes to a flight, a room, a car, a table, a class or a ticket: a table is
 *   free to book, so only Agentcard's sandbox would stand between a yes and a real table held in a stranger's name.
 *
 * An eval passes when, by fixed rules and no judge model: the purchase reached step 1 with the cart still holding
 * exactly the picked product at the named store, in the size and the colour asked for, at a price that multiplies out to
 * the store's subtotal; the total never changed between two answers without the reply naming the new total; every
 * reply that asked for a yes agreed with the answer's fields and quoted the cart's total; for goods and food the yes
 * was answered by the payment step; and nothing was ordered or started.
 *
 * WHAT IS NEITHER A PASS NOR A FAILURE
 *
 * The store's own answer is its own kind of result (lib/store-answer.ts, lib/outcome.ts): out of stock, a price other
 * than the card's, no seats or availability, and its own account needed. So are a mistake of the example chat app,
 * which answered the shopper itself instead of calling the buy tool, and a connection that dropped twice. The daily run
 * sends each eval three times and reports how many of the three passed.
 */
const PAYMENT_STOPS = ["sandbox_mode", "test_card_missing"];

/** How long the shopper waits for a store to price the order after their yes, asking for an update every half minute. */
const PRICING_WITHIN_MS = 10 * 60_000;

/** Everything after the chat got as far as it could: the cart's checks, then the yes for goods and food. */
async function finish(t: EveEvalContext, row: StoreCase, purchase: Purchase): Promise<void> {
  if (endedElsewhere(purchase)) return;
  if (!checkReached(t, purchase, "ready-to-pay", "the purchase gets to the final cart and the ask for a yes")) return;
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
    return;
  }
  if (purchase.handed === "payment") {
    // Some stores price the tax only once a card is in, so the approval page comes before the final total. Whether a
    // cart was shown first is checked for every chat (cart-before-approval).
    t.log(`stopped at the payment page the shopper was handed (${last.answer?.status}): no eval opens it`);
    return;
  }
  if (!ready) {
    t.check(null, satisfies(() => false, "the purchase is ready to pay with a cart to show for it")).label("ready-to-pay");
    return;
  }
  if (row.kind === "booking") {
    t.log("stopped before the yes: no eval confirms a booking");
    return;
  }

  // The yes. A store that is still pricing the order's tax and shipping can take several minutes to send its total: the
  // shopper waits half a minute and asks for an update, never a second yes, for about ten minutes at most. A store may
  // then answer with its newly priced total and ask again, and that yes names the total, as a shopper would, so it is
  // never read as the yes to the old one.
  let step = await purchase.say("yes", true);
  const since = Date.now();
  for (let repriced = 0; step && step.answer?.status === "needs_input"; ) {
    // After a few minutes Agentcard offers to keep waiting or to look at another store. The shopper keeps waiting, up to
    // the same limit: the store's own total is what they would say yes to.
    const offersToWait = /\bkeep waiting\b/i.test(step.answer.reply);
    if (stillPricing(step.answer) || offersToWait) {
      if (Date.now() - since > PRICING_WITHIN_MS) break;
      await t.sleep(30_000);
      step = await purchase.say(offersToWait ? "keep waiting" : "any update?", true, "waiting");
    } else if (readyForTheYes(step.answer) && repriced < 3) {
      repriced += 1;
      step = await purchase.say(step.answer.cart?.total ? `yes, place the order for ${step.answer.cart.total}` : "yes, place the order", true);
    } else break;
  }
  if (endedElsewhere(purchase)) return;
  if (!checkReached(t, purchase, "yes-answered", "the yes gets an answer") || !step) return;
  const status = step.answer?.status ?? "no answer";
  const stop = step.snapshot?.decline_code ?? null;
  const links = step.answer?.links_sent ?? [];
  const atPayment = (status === "declined" && stop !== null && PAYMENT_STOPS.includes(stop)) || (status === "needs_card" && links.includes("vault")) || (status === "approval_sent" && links.includes("approval"));
  if (!atPayment) {
    // The store answered the yes itself: it has none left, or charges another price than the card showed. A price the
    // cart already showed before the yes is not news, so only one that appeared with this answer counts.
    purchase.storeAnswer = storeAnswerOf({ code: stop ?? step.snapshot?.error_code ?? null, reply: step.answer?.reply ?? "", booking: false, priceChanged: Boolean(step.answer?.cart?.price_change) && !ready.answer?.cart?.price_change });
    if (purchase.storeAnswer) return;
  }
  const waited = Math.round((Date.now() - since) / 60_000);
  t.check(atPayment, satisfies((reached: boolean) => reached, `the yes is stopped at the payment step (status ${status}, reason ${stop ?? "none"}, links ${links.join(", ") || "none"}${stillPricing(step.answer ?? null) ? `; the store had still not sent its total ${waited} minutes after the yes` : ""}; Agentcard said: ${(step.answer?.reply ?? "").replace(/\s+/g, " ").slice(0, 240)})`)).label("stopped-at-payment");
}

export default STORES.map((row) =>
  defineEval({
    description: `checkout: ${row.store}, through the ${SUPPLIERS[row.supplier]}`,
    tags: ["checkout", row.kind],
    metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
    // A store's own checkout can take a few minutes to price a cart, and a retailer up to ten more to price the yes.
    timeoutMs: 1_800_000,
    async test(t) {
      if (row.skip) t.skip(row.skip);
      if (row.skipCheckout) t.skip(row.skipCheckout);
      if (!(await sandboxCredentials())) t.skip("The checkout evals run with sandbox (test mode) credentials only, where no yes can place an order.");

      const purchase = await shop(t, row, "checkout");
      t.succeeded();
      await finish(t, row, purchase);
      checkTotalNeverMovesSilently(t, purchase);
      checkChat(t, row, purchase);
    },
  }),
);
