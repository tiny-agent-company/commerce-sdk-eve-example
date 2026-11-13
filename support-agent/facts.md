# Agentcard support: current facts

The support agent quotes these and nothing else. When a customer asks about something that isn't here, the agent checks the code or the database, answers, and adds a line to this file with the date and where it checked.

Every line carries the date it was last confirmed and its source. A fact older than 30 days gets checked again before it's quoted.

## Plans and orders

- **Agentcard is for companies only. We don't offer a personal (B2C) product.** No personal plans to buy, no new personal accounts. Someone writing in as an individual is told this plainly on the first reply, and if they're building something, pointed to a company account. Confirmed by Karen 2026-10-27. The code still carries personal-plan copy ("Basic is $15/mo, run upgrade_plan" in `card-limits.ts` `FREE_ORDER_LIMIT_MESSAGE`). That copy is stale and must never be quoted.
- **Legacy free plan (existing personal accounts only): one live placed order, ever.** It's a lifetime limit, not one order at a time. Sandbox and test mode never count. Confirmed 2026-10-26, `card-limits.ts` `checkOrderQuota` / `getLifetimePlacedOrderCount`.
- **The free-order limit doesn't apply to company integrations.** A purchase made through an organization's own OAuth client (Purchase API, Commerce SDK, an org's iMessage line) is billed to the company and never hits the personal free-order limit. Confirmed 2026-10-26, `card-limits.ts` `isOrgBackedClient`, `checkout.ts` step 1b.
- **Known bug: a retailer-cancelled order still uses up the free order.** Only orders our reconciler releases are excluded. A cancellation from the store after placement isn't. Fixing an affected account is a manual reset. Confirmed 2026-10-26, `getLifetimePlacedOrderCount` excludes `RELEASED` only.
- **Commerce fee:** 1% on every live purchase, paid by the company. Live purchases stay paused until the company picks Prefund or Pay as you go under Commerce SDK > Balance. Decline code `commerce_billing_required`. Source: 23 Oct reply to Omari, docs `commerce-sdk/quickstart#go-live`.

## Funding

- **Apple Pay / Google Pay top-ups depend on the country of residence from verification,** not where the card was issued and not citizenship. Not available in 47+ countries, including Canada, UK, Australia, Japan, India, Singapore, UAE, Turkey, Thailand, Kazakhstan and China. Full list: 13 Sep reply to Nikita. Re-check before quoting.
- **USDC deposits are Base only.** Anything sent on another network is lost.
- **There's no screen or API that shows a personal USDC deposit address.** Support doesn't read addresses out over email.
- **Company balance:** the company wallet has its own USDC-on-Base deposit address. Live company-funded issuance is switched on per company, and Karen or Felipe decides.

## Verification

- **Changing the country on a finished verification** means reopening it. That's a manual admin reset (`/admin/kyc/sumsub-reset`), and Karen or Felipe has to approve it.
- **Verification links last 48 hours.** Calling start again issues a fresh link and doesn't reset anything.

## Products and packages

- **Agent Bundle: $20/mo.** It was $25 before June, and any doc that still says $25 is stale.
- **SDK package:** `@agent-cards/sdk`. `@agent-cards/checkout` is the old name.

## Things support never tells a customer

- **Why a specific person failed verification.** That covers fraud match, duplicate, sanctions and age. Say "the review reached a final decision, and our compliance team can look at it", and send it to Karen.
- **Issuer or vendor limits and names:** cardholder caps, Rain, Sumsub internals, Duffel.
- **Our fee internals,** such as what a payment provider deducts and what we absorb.
- **Dates for fixes that are only in a draft PR.**
