/**
 * The stores where the evals' shopper has a test account of their own saved with Agentcard.
 *
 * At a store that needs an account, Agentcard signs in with the shopper's own account at that store, which the shopper
 * gave once on Agentcard's own page (never in the chat). An eval must never use a real person's account, and no eval
 * creates an account at a real store. So a store counts here only once a person has made a test account there, for
 * testing only, and saved it with Agentcard for the shopper the evals play. The stores that need one are the ones the
 * evals see ask for a sign-in (buy/store-account.eval.ts and the stores' rows in lib/stores.ts).
 *
 * Until a store is listed here, a sign-in it asks for is reported as that store's own answer, "no test account at this
 * store", and never as a failure. Once it is listed, the purchase must go through without asking the shopper to sign in:
 * Agentcard signs in with the saved account by itself.
 *
 * Only the store's name goes here, matched against the store an eval names. Never an email, a password or a code: this
 * repository is public.
 */
const TEST_ACCOUNTS: RegExp[] = [];

/** True when the evals' shopper has a test account saved at this store. */
export function testAccountAt(store: string): boolean {
  return TEST_ACCOUNTS.some((at) => at.test(store));
}
