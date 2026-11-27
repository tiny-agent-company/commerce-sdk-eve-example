import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { ASKS_PHONE, checkChat, GIVES_A_REASON, sandboxCredentials, shop, SHOPPER } from "../lib/purchase.js";
import { STORES, SUPPLIERS } from "../lib/stores.js";

/**
 * A shopper whose contact details are refused is told which detail was refused, and why.
 *
 * Every other booking eval gives contact details the booking suppliers accept (lib/purchase.ts). This one keeps the
 * placeholders they refuse: an email on a domain reserved for examples and a phone number from the range reserved for
 * fiction. The restaurant booking supplier turns both down before anything runs, so the table is asked for with them.
 * On 2026-11-26 a shopper in this spot was asked for a yes while the booking still listed their email and phone as
 * missing, and nothing told them why.
 *
 * The shopper asks for a table, picks one and gives the details. The eval passes when, by fixed rules and no judge model:
 * - the booking asks for the details at all;
 * - once they are refused, a reply names the email or the phone as the detail that was not taken, and gives the reason;
 * - no reply asks for a yes while a detail is still missing, and nothing is booked (the checks every purchase chat gets).
 *
 * If a supplier takes the placeholders after all, there is no refusal to word, and the eval says so in its log.
 */
const table = STORES.find((row) => row.supplier === "tables")!;
const row = { ...table, contact: "refused" as const };

export default defineEval({
  description: `refused details: ${row.store}, through the ${SUPPLIERS[row.supplier]}, with an email and a phone the supplier refuses`,
  tags: ["refused-details", row.kind],
  metadata: { ask: row.ask, store: row.store, supplier: SUPPLIERS[row.supplier] },
  timeoutMs: 1_200_000,
  async test(t) {
    if (!(await sandboxCredentials())) t.skip("This eval runs with sandbox (test mode) credentials only.");

    const purchase = await shop(t, row, "checkout");
    t.succeeded();
    const gave = purchase.steps.findIndex((step) => step.said.includes(SHOPPER.email) || step.said.includes(SHOPPER.phone));
    const stoppedEarly = purchase.storeAnswer || purchase.appGaveUp || purchase.broke;
    if (!stoppedEarly) {
      t.check(gave, satisfies((at: number) => at >= 0, `the booking asks for the guest's email and phone${purchase.stopped ? ` (${purchase.stopped})` : ""}`)).label("details-asked-for");
    }
    if (gave >= 0) {
      const after = purchase.steps.slice(gave).filter((step) => step.answer !== null);
      const refused = after.some((step) => (step.answer!.cart?.details_needed ?? []).some((detail) => detail === "email" || detail === "phone") || step.answer!.next_action === "guest_details");
      if (!refused) t.log("the supplier took the placeholder email and phone this time, so there was no refusal to word");
      else {
        const told = after.find((step) => (/e-?mail/i.test(step.answer!.reply) || ASKS_PHONE.test(step.answer!.reply)) && GIVES_A_REASON.test(step.answer!.reply));
        const said = after.map((step) => step.answer!.reply.replace(/\s+/g, " ").slice(0, 200)).join(" / ");
        t.check(told ?? null, satisfies((step: unknown) => step !== null, `the shopper is told which detail was refused, the email or the phone, and why (after the details, Agentcard said: ${said})`)).label("told-which-detail-was-refused");
      }
    }
    checkChat(t, row, purchase);
  },
});
