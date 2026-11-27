import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { chatAgainOnce } from "../lib/connection.ts";
import { limitFor, oneAfterAnother } from "../lib/one-after-another.ts";
import { cartStep, checkCart, checkChat, checkReached, endedElsewhere, logPath, sandboxCredentials, shop } from "../lib/purchase.js";
import { ACCOUNT_SHOPPER, savedAccountAt, testAccountAt } from "../lib/store-accounts.ts";
import { STORES, SUPPLIERS } from "../lib/stores.js";

/**
 * A store that sells only to a shopper signed in to their own account there: Agentcard signs in with that account.
 *
 * The shopper gives their account at the store once, on Agentcard's own page, never in the chat. Agentcard keeps it
 * sealed, signs in with it whenever the store needs it, and signs in again by itself when the store's session runs out.
 * It asks the shopper again only for a code the store sends them or for a password they changed.
 *
 * One eval per row of lib/stores.ts the evals have seen need an account (`needsAccount`). The shopper asks for the
 * product and picks a card, as in the cart evals, and the eval passes when, by fixed rules and no judge model:
 * - with a test account saved at the store for the account shopper, and the run started as that shopper
 *   (`EVAL_SHOPPER_ID=evals-store-accounts`, which the daily run on Modal does for these evals; lib/store-accounts.ts),
 *   the product gets into a cart at that store with no sign-in asked for, and the cart is right (the cart evals' checks);
 * - with none, which is every store until a person makes one, Agentcard asks for the shopper's own account at the store
 *   they named, before any other question, and the answer's next step is that sign-in. That is reported as the store's
 *   own answer, "no test account at this store", never as a failure;
 * - no reply asks the shopper to type a password into the chat, and nothing is ordered (the checks every chat gets).
 *
 * A store that does not ask for an account this time, and puts the product in a cart, passes with the cart's checks.
 *
 * The evals run with sandbox (test mode) credentials only, and skip themselves otherwise. No eval signs in anywhere with
 * a real person's account, and none creates an account at a store.
 */
const RUN_LIMIT_MS = 1_200_000;

export default STORES.filter((row) => row.needsAccount).map((row) => {
  const supplier = SUPPLIERS[row.supplier];
  const description = `store account: ${row.store}, through ${supplier.startsWith("the ") ? supplier : `the ${supplier}`}`;
  return defineEval({
    description,
    tags: ["store-account", row.kind],
    metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
    // Each run of this eval waits for the one before it (lib/one-after-another.ts), so its limit covers theirs too.
    timeoutMs: limitFor(RUN_LIMIT_MS),
    async test(t) {
      if (row.skip) t.skip(row.skip);
      if (!(await sandboxCredentials())) t.skip("These evals run with sandbox (test mode) credentials only.");

      const purchase = await oneAfterAnother(description, RUN_LIMIT_MS, () => chatAgainOnce(() => shop(t, row, "cart"), (line) => t.log(line)));
      t.succeeded();
      t.log(
        savedAccountAt(row.store)
          ? `the shopper has a test account saved at ${row.store}: Agentcard signs in with it by itself`
          : testAccountAt(row.store)
            ? `the evals have a test account at ${row.store}, saved for the shopper ${ACCOUNT_SHOPPER}, and this run is another shopper (set EVAL_SHOPPER_ID=${ACCOUNT_SHOPPER} to use it)`
            : `the evals have no test account at ${row.store} yet (lib/store-accounts.ts)`,
      );

      if (purchase.signIn) {
        // The account asked for is the shopper's own at the store they named, never one at another store.
        const said = purchase.signIn.said;
        t.check(said, satisfies((reply: string) => row.at === undefined || row.at.test(reply), `the sign-in Agentcard asks for is the shopper's own account at ${row.store}, named in the reply (Agentcard said: ${said})`)).label("sign-in-names-the-store");
      } else {
        const step = cartStep(purchase);
        if (!endedElsewhere(purchase) && purchase.handed !== "sign-in") {
          if (!step && !purchase.stopped) purchase.stopped = `the chat ended with no cart shown and no sign-in asked for. Agentcard said: ${(purchase.steps.at(-1)?.answer?.reply ?? "").replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").slice(0, 220)}`;
          if (checkReached(t, purchase, "product-in-cart", "the product gets into a cart, or Agentcard asks for the shopper's own account at the store") && step) {
            t.log(`${row.store} did not ask for an account this time`);
            logPath(t, row, step.snapshot?.carts.at(-1)?.merchant);
            checkCart(t, row, purchase, step);
          }
        }
      }
      checkChat(t, row, purchase);
    },
  });
});
