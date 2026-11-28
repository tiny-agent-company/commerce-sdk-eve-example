/**
 * The stores where the evals' account shopper has a test account of their own saved with Agentcard.
 *
 * At a store that needs an account, Agentcard signs in with the shopper's own account at that store, which the shopper
 * gave once on Agentcard's own store sign-in page (never in the chat). An eval must never use a real person's account,
 * and no eval creates an account. So a store counts here only once a person has made a test account there, for testing
 * only, and it was saved on that page for one test shopper, `ACCOUNT_SHOPPER`. That shopper is nobody: an id the example
 * app uses for every chat of a run started with `EVAL_SHOPPER_ID` set to it (agent/tools/buy.ts). Every other eval run
 * gives each chat a shopper of its own, who has no account anywhere.
 *
 * So a store's sign-in is graded by who the run's shopper is (`savedAccountAt`):
 * - the account shopper, at a store listed here: Agentcard signs in with the saved account by itself, and asking the
 *   shopper to sign in is a failure;
 * - anyone else, or a store not listed: a sign-in asked for first is that store's own answer, "no test account at this
 *   store", and never a failure.
 *
 * Only the store's name goes here, matched against the store an eval names. Never an email, a password or a code: this
 * repository is public. The accounts themselves are kept outside it.
 */
// Saved on Agentcard's store sign-in page for ACCOUNT_SHOPPER on 2026-11-28: McMaster-Carr (its sign-in form is read
// since #18082), Target (Target signs in with a code it emails, which the page took) and Costco (a non-member account;
// the page linked it after the email). Sephora, eBay, TikTok Shop and Gap have no test account yet. Add a store here once
// its account is saved on the page for ACCOUNT_SHOPPER.
const TEST_ACCOUNTS: RegExp[] = [/mcmaster/i, /target/i, /costco/i];

/** The test shopper the store accounts are saved for. A run is this shopper when it starts with EVAL_SHOPPER_ID set to it. */
export const ACCOUNT_SHOPPER = "evals-store-accounts";

/** True when a person made a test account at this store and saved it for the account shopper. */
export function testAccountAt(store: string): boolean {
  return TEST_ACCOUNTS.some((at) => at.test(store));
}

/** True when this run's shopper has a test account saved at this store: the run is the account shopper's, and the store is listed. */
export function savedAccountAt(store: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EVAL_SHOPPER_ID === ACCOUNT_SHOPPER && testAccountAt(store);
}
