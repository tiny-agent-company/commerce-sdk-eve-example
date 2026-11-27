/**
 * A store's own answer: the purchase stopped because of something only the store decides, and Agentcard said so.
 *
 * Four of them, the same at every store and every supplier:
 * - the product is out of stock;
 * - the store's price differs from the price on the card the shopper picked;
 * - a booking has no seats or no availability;
 * - the store needs the shopper's own account.
 *
 * None is a failure of Agentcard's, and none is a pass either: nothing got as far as a cart or a payment step. Each is
 * reported as its own kind of result (lib/outcome.ts), with what Agentcard said, so a person can still read it.
 *
 * Each is decided from the answer's fields where it has one for it: the code the purchase stopped with, the cart's
 * `price_change`, a card's `availability`, the sign-in step. Where an answer carries no field for it, the reply's own
 * words are read, and the result says so (`read_from`), because words are a weaker sign than a field. On 2026-11-26 a
 * store's "out of stock" after the shopper's yes came with no code at all.
 */

export type StoreAnswerKind = "out of stock" | "the store's price differs from the card's" | "no seats or availability" | "the store needs an account";

export interface StoreAnswer {
  what: StoreAnswerKind;
  read_from: "the answer's fields" | "the reply's words";
  /** What Agentcard told the shopper, shortened. */
  said: string;
}

/** The part of one answer this file reads. */
export interface AnswerFacts {
  /** The code the purchase stopped with, or the error's code, as the app reads it. */
  code: string | null;
  reply: string;
  /** True for a flight, a room, a car, a table, a class, a ticket or an event: what runs out there is seats, not stock. */
  booking: boolean;
  /** True when the cart says the store charges another price than the card showed. */
  priceChanged?: boolean;
  /** The cards the answer showed, when the shopper could pick none of them. */
  cards?: { availability: string | null; price: string | null }[];
  /** True for a booking that costs nothing, whose cards show no price. */
  free?: boolean;
}

const short = (text: string, most = 300) => text.replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").trim().slice(0, most);

/**
 * The codes a purchase stops with that are the store's own answer. Each rule names the fact and nothing wider: a code
 * such as `merchant_unavailable` says a supplier could not be reached, which is a failure, so "unavailable" alone is
 * never read as "no room".
 */
const SOLD_OUT_CODE = /(^|_)(sold_out|out_of_stock)($|_)|^items_unavailable$/;
const PRICE_CODE = /(^|_)price_(changed|change|mismatch|differs|rose|above_listed)($|_)|^max_price_exceeded$/;
const NO_ROOM_CODE = /^(no_availability|not_available|no_seats|no_listings|no_rooms|no_tables|fully_booked|sold_out|slot_unavailable|time_unavailable)$/;

const SOLD_OUT_WORDS = /\b(out of stock|out-of-stock|sold out|not in stock|isn't in stock|is not in stock|no longer in stock|none left in stock)\b|\b(no longer|doesn't|does not|didn't|did not) (has|have|carry|carries|stock|stocks)\b[^.?!]{0,100}\bin stock\b/i;
const PRICE_WORDS = /\bprice (has |had )?(changed|went up|gone up|rose|risen|increased|dropped|is different|differs)\b|\b(costs?|charges?|priced?( it| the \w+)?|price (is|was|of)|lists? it)\b(?:[^.?!]|\.\d){0,90}\b(more than|higher than|above|instead of|rather than|not the|different from|and not)\b|\b(now|actually) \$\d/i;
const NO_ROOM_WORDS = /\bno (seats?|tickets?|listings?|tables?|rooms?|availability|flights?|classes|cars?|spots?|openings?|times?|slots?)\b|\bnone (of them )?(has|have|is|are)\b[^.?!]{0,60}\bavailable\b|\b(fully|all) booked\b|\bsold out\b|\bnothing (is )?(available|open|left)\b|\bno \w+( \w+)? (is|are) available\b/i;

/**
 * The store's own answer an answer gives, or null when it gives none. Read at the point a chat cannot go on: a stop
 * before the cart, a refusal after the yes, or a search whose cards the shopper cannot pick.
 */
export function storeAnswerOf(facts: AnswerFacts): StoreAnswer | null {
  const code = (facts.code ?? "").toLowerCase();
  const said = short(facts.reply);
  const fromFields = (what: StoreAnswerKind): StoreAnswer => ({ what, read_from: "the answer's fields", said });
  const fromWords = (what: StoreAnswerKind): StoreAnswer => ({ what, read_from: "the reply's words", said });

  if (facts.priceChanged || PRICE_CODE.test(code)) return fromFields("the store's price differs from the card's");
  if (facts.booking && NO_ROOM_CODE.test(code)) return fromFields("no seats or availability");
  if (!facts.booking && SOLD_OUT_CODE.test(code)) return fromFields("out of stock");
  // A booking's cards, when every one of them says it has no room, or shows no price to book it at.
  const cards = facts.cards ?? [];
  if (facts.booking && cards.length > 0 && cards.every((card) => card.availability === "unavailable" || (!facts.free && card.price === null))) return fromFields("no seats or availability");

  if (facts.booking && NO_ROOM_WORDS.test(facts.reply)) return fromWords("no seats or availability");
  if (!facts.booking && SOLD_OUT_WORDS.test(facts.reply)) return fromWords("out of stock");
  if (PRICE_WORDS.test(facts.reply) && /\$\s?\d/.test(facts.reply)) return fromWords("the store's price differs from the card's");
  return null;
}

/** True when a code or a step says the store wants the shopper's own account before it goes on. */
export function needsAccount(facts: { code: string | null; nextAction: string | null; links: readonly string[] }): boolean {
  return facts.nextAction === "store_login" || facts.links.includes("store_login") || /account_required|sign_in_required|login_required|store_login/.test((facts.code ?? "").toLowerCase());
}

/**
 * True when a reply that asks for a sign-in also offers the product at another store, as the alternative to signing
 * in. `otherStores` are the stores of the cards and the store choices the same answer carries, other than the store the
 * shopper named: a field says it without reading words. With no such field, the reply's own words are read.
 */
export function offersAnotherStore(reply: string, otherStores: readonly string[]): { offered: boolean; readFrom: "the answer's fields" | "the reply's words" | null } {
  if (otherStores.length > 0) return { offered: true, readFrom: "the answer's fields" };
  if (/\b(another|other|a different) (store|shop|seller|retailer|site)s?\b|\belsewhere\b|\b(or|instead),? (i can |i could |you can |we can )?(get|buy|order|find|try|check|look)\b[^.?!]{0,80}\b(at|from|on)\b|\b(also|same \w+) (sells?|sold|available|is) (at|from|on)\b/i.test(reply)) return { offered: true, readFrom: "the reply's words" };
  return { offered: false, readFrom: null };
}

/** The amounts of money a text quotes, in cents, in the order it quotes them. */
export function amountsIn(text: string): number[] {
  return [...text.replace(/,(?=\d{3})/g, "").matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((found) => Math.round(Number(found[1]) * 100));
}
