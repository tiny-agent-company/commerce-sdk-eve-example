/**
 * A store's own answer: the purchase stopped because of something only the store decides, and Agentcard said so.
 *
 * Six of them, the same at every store and every supplier:
 * - the product is out of stock;
 * - the store's price differs from the price on the card the shopper picked;
 * - a booking has no seats or no availability;
 * - the store needs the shopper's own account;
 * - the store needs the shopper's own account, and the evals have no test account there to sign in with (Agentcard
 *   signs in with the shopper's own saved account at a store that needs one, and an eval must never use a real one);
 * - the store was slow to price: it sent no total within the time the shopper waits, while Agentcard kept the shopper
 *   told how long it had been and offered to keep waiting or to try another store.
 *
 * None is a failure of Agentcard's, and none is a pass either: nothing got as far as a cart or a payment step. Each is
 * reported as its own kind of result (lib/outcome.ts), with what Agentcard said, so a person can still read it.
 *
 * Each is decided from the answer's fields where it has one for it: the code the purchase stopped with, the cart's
 * `price_change` and `pricing`, a card's `availability`, the sign-in step. Where an answer carries no field for it, the
 * reply's own words are read, and the result says so (`read_from`), because words are a weaker sign than a field. On
 * 2026-11-26 a store's "out of stock" after the shopper's yes came with no code at all.
 */

export type StoreAnswerKind =
  | "out of stock"
  | "the store's price differs from the card's"
  | "no seats or availability"
  | "the store needs an account"
  | "no test account at this store"
  | "the store was slow to price";

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
const NO_ROOM_WORDS = /\bno (seats?|tickets?|listings?|tables?|rooms?|availability|flights?|classes|cars?|spots?|openings?|times?|slots?|pairs? of (seats|tickets))\b|\bnothing (\w+ )?to book\b|\bnone (of them )?(has|have|is|are)\b[^.?!]{0,60}\bavailable\b|\b(fully|all) booked\b|\bsold out\b|\bnothing (is )?(available|open|left)\b|\bno \w+( \w+)? (is|are) available\b/i;

/**
 * The store's own answer an answer gives, or null when it gives none. Read at the point a chat cannot go on: a stop
 * before the cart, a refusal after the yes, or a search whose cards the shopper cannot pick.
 */
export function storeAnswerOf(facts: AnswerFacts): StoreAnswer | null {
  const code = (facts.code ?? "").toLowerCase();
  const said = short(facts.reply);
  const fromFields = (what: StoreAnswerKind): StoreAnswer => ({ what, read_from: "the answer's fields", said });
  const fromWords = (what: StoreAnswerKind): StoreAnswer => ({ what, read_from: "the reply's words", said });

  // A booking's search that found nothing bookable in the dates asked says so in its code, `no_availability`, which is
  // read before anything else: the code is the surest sign there is.
  if (facts.booking && noRoomByCode(facts.code)) return fromFields("no seats or availability");
  if (facts.priceChanged || PRICE_CODE.test(code)) return fromFields("the store's price differs from the card's");
  if (!facts.booking && SOLD_OUT_CODE.test(code)) return fromFields("out of stock");
  // A booking's cards, when every one of them says it has no room, or shows no price to book it at.
  const cards = facts.cards ?? [];
  if (facts.booking && cards.length > 0 && cards.every((card) => card.availability === "unavailable" || (!facts.free && card.price === null))) return fromFields("no seats or availability");

  if (facts.booking && NO_ROOM_WORDS.test(facts.reply)) return fromWords("no seats or availability");
  if (!facts.booking && SOLD_OUT_WORDS.test(facts.reply)) return fromWords("out of stock");
  if (PRICE_WORDS.test(facts.reply) && /\$\s?\d/.test(facts.reply)) return fromWords("the store's price differs from the card's");
  return null;
}

/** True when a booking's code says nothing can be booked: `no_availability`, `fully_booked` and the like. */
export function noRoomByCode(code: string | null): boolean {
  return NO_ROOM_CODE.test((code ?? "").toLowerCase());
}

/**
 * The steps and links that hand the shopper to their own account at a store: the sign-in page of round 1
 * (`store_login`), and the page where the shopper gives Agentcard their account at that store, which Agentcard then
 * signs in with by itself.
 */
const ACCOUNT_STEP = /^store_(login|account|sign_?in|credentials)$/;

/** True when a code or a step says the store wants the shopper's own account before it goes on. */
export function needsAccount(facts: { code: string | null; nextAction: string | null; links: readonly string[] }): boolean {
  return ACCOUNT_STEP.test(facts.nextAction ?? "") || facts.links.some((link) => ACCOUNT_STEP.test(link)) || /account_required|sign_in_required|login_required|store_login|store_account/.test((facts.code ?? "").toLowerCase());
}

/**
 * True when a reply asks the shopper to type the password of their store account into the chat. Agentcard takes a
 * password only on its own page, never in the chat, where it would be kept as words. A code the store sends the shopper
 * may be asked for in the chat.
 */
export function asksPasswordInChat(reply: string): boolean {
  return reply.split(/(?<=[.?!])\s+|\n+/).some((sentence) => /\bpassword\b/i.test(sentence) && /\b(send|type|tell|give|reply|share|paste|enter)\b[^.?!]{0,40}\b(me|here|in (the|this) chat|below)\b|\bwhat(?:'s| is) your password\b/i.test(sentence) && !/\b(never|don't|do not|won't|will not)\b[^.?!]{0,30}\bpassword\b|\bon (the|this|our) (page|link)\b|\bthrough (the|this) link\b/i.test(sentence));
}

/** The amounts of money a text quotes, in cents, in the order it quotes them. */
export function amountsIn(text: string): number[] {
  return [...text.replace(/,(?=\d{3})/g, "").matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((found) => Math.round(Number(found[1]) * 100));
}
