import { AgentcardClient } from "@agent-cards/commerce-sdk";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { RECORD } from "./braintrust-reporter.ts";
import { buyCalls, cardsShown, checkTurn, checkWordsUnchanged, dollars, lastAnswer, type Card } from "./buy.ts";
import { ChatBroke, deliver, type Chat } from "./connection.ts";
import { cardDays, daysIn, inWindow } from "./dates.ts";
import { OUTCOME, type Outcome } from "./outcome.ts";
import { namesAnotherColor, namesAnotherSize, placeholderNames, showsColor, showsSize, valueOf, type Group } from "./questions.ts";
import { amountsIn, asksPasswordInChat, closedOrGoneOf, needsAccount, noRoomByCode, storeAnswerOf, type StoreAnswer } from "./store-answer.ts";
import { readReply, type Detail as ReadDetail, type Reading } from "./reply-reader.ts";
import { savedAccountAt } from "./store-accounts.ts";
import { SUPPLIERS, type StoreCase } from "./stores.ts";

/**
 * The shopper the cart and checkout evals play: it asks for a product, picks one card, and then answers what the
 * checkout asks, with placeholder details only, until the product is in a cart or the purchase is ready to pay.
 *
 * Nothing here is a real person's. The address is a public landmark (the one Agentcard's own sandbox guide ships to),
 * the name is the usual stand-in, the email is on a domain reserved for examples, and the phone number is in the range
 * reserved for fiction.
 */
export const SHOPPER = {
  address: "1 Ferry Building, San Francisco, CA 94111",
  name: "Jane Doe",
  email: "jane.doe@example.com",
  phone: "415-555-0137",
  bornOn: "1990-04-12",
  gender: "f",
};

/**
 * The contact details a booking is asked for with. A table or a class is booked through a supplier that refuses, before
 * anything runs, an email on a domain reserved for examples and a North American phone number from the range reserved
 * for fiction, which are exactly the placeholders above. So a booking gives an email at Agentcard's own domain, where
 * nothing sent can reach a stranger, and a mobile number from the range Australia's regulator keeps for films and TV
 * (0491 570 006 is the first on its list), which no person can hold. Still no person's details, and no eval ever says
 * yes to a booking.
 *
 * Why this number and not another: Agentcard reads every phone number with a phone number library before a supplier
 * sees it, and a supplier then applies its own rule. This one passes both. The United Kingdom's drama number that a
 * supplier's notes record a practice booking with, +44 7700 900123, does not pass Agentcard's own reading any more: the
 * library does not count it as a number the United Kingdom dials (tried 2026-11-26, refused at every booking).
 *
 * Goods keep the placeholders above: a store's own checkout form takes a phone number of the country it ships to.
 */
export const BOOKING_CONTACT = { email: "evals@agentcard.sh", phone: "+61 491 570 006" };

type Contact = typeof SHOPPER;

/**
 * The details this row's shopper has to give, the ones they give first and then their other ones. Suppliers do not agree
 * on what they take, and a number one of them takes another may refuse. So a booking's shopper has two sets, as a person
 * has two phones, and gives the second only when told the first was not taken. The one row that keeps the refused
 * placeholders has those alone, and so do goods and food.
 */
export function contactsOf(row: StoreCase): Contact[] {
  return row.kind === "booking" && row.contact !== "refused" ? [{ ...SHOPPER, ...BOOKING_CONTACT }, SHOPPER] : [SHOPPER];
}

/** The host of the product catalog supplier's links. A card whose page is there came from the catalog. */
const CATALOG_HOST = /(^|\.)trychannel3\.com$/i;

/** What a shopper who was told "still working" types after waiting, to hear the late result. Never a yes. */
const ANY_UPDATE = "any update?";
/** How long the shopper waits between two such messages, and how long in all before the result counts as never arriving. */
const WAIT_BETWEEN_MS = 20_000;
const LATE_RESULT_WITHIN_MS = 8 * 60_000;
/** How long the chat is watched for a message whose sending broke, before it counts as never having arrived. */
const ARRIVES_WITHIN_MS = 30_000;

/** One cart as the model reads it: the part these evals check. */
interface Cart {
  store: string;
  /** `price_in_total` is set on a line the store prices only inside the cart's total (Commerce SDK 0.35.0). */
  items: { product_id: string | null; other_product_ids?: string[]; name: string; qty: number; price: string | null; line_total: string | null; price_in_total?: true; options?: string[]; variant?: string | null }[];
  fees: string | null;
  total: string;
  total_is_estimate: boolean;
  total_status?: string;
  /** True while the store's checkout still prices this cart. */
  pricing?: true;
  store_total?: string;
  max_charge?: string | null;
  details_needed?: string[];
  /** The store's own order summary, when Agentcard read it. */
  breakdown?: { subtotal: string; shipping: string | null; tax: string | null; discount: string | null };
  /** Set when the store charges another price than the card the shopper picked showed. */
  price_change?: { card_price: string; store_price: string | null; heads_up: string };
}

/** The buy tool's answer as the model reads it. */
export interface Answer {
  status: string;
  next_action: string | null;
  reply: string;
  cart: Cart | null;
  links_sent?: string[];
  choice?: { question: string | null; groups: Group[] };
  products?: { product_id: string | null; name: string; store: string; price: string | null }[];
  stores?: { store_id: string; name: string }[];
  /** The store whose checkout is still building the cart this answer named. */
  cart_building?: { store: string };
}

/** One cart as the app reads it, in cents, with the name of the path it is checked out through. */
interface RawCart {
  merchant: string;
  subtotalCents: number | null;
  serviceFeesCents: number | null;
  tipCents: number;
  totalCents: number;
  totalIsEstimate: boolean;
  discounts?: { amountCents?: number; amount_cents?: number }[];
  items: { lineTotalCents?: number | null }[];
}

/** Where the purchase stands after a turn, from what the buy tool streamed to the chat. */
interface Snapshot {
  status: string | null;
  next_action: string | null;
  decline_code: string | null;
  error_code: string | null;
  order_id: string | null;
  carts: RawCart[];
  links: { kind: string; url?: string | null; productId?: string; availability?: { status: string } }[];
  /** When each card's booking starts, by the card's id, where Agentcard's answer names it (agent/lib/card-dates.ts). */
  card_dates?: Record<string, string>;
  /** True when the call answered while Agentcard still worked on the request. */
  turn_continues?: boolean;
}

/** One message of the chat and what came back. */
export interface Step {
  said: string;
  turn: EveEvalTurn;
  answer: Answer | null;
  snapshot: Snapshot | null;
  /** What the reply asks and says, read by a model (lib/reply-reader.ts), or null when it could not be read. */
  reading: Reading | null;
  /**
   * Set for a message that is not the shopper's next answer: `waiting` for "any update?" after a "still working", and
   * `said again` for a message the example chat app answered itself, typed once more.
   */
  why?: "waiting" | "said again";
}

/** A card as the shopper saw it, with what the answer says of where it leads, whether it has room and when it is. */
export interface ShownCard extends Card {
  page: "catalog" | "store page" | null;
  url: string | null;
  availability: string | null;
  /** The time Agentcard's answer names for the card, such as a flight's departure, or null when it names none. */
  date: string | null;
}

export interface Purchase {
  steps: Step[];
  /** The card the shopper picked, or null when the first answer carted the product itself or showed no card to pick. */
  picked: Card | null;
  /** Why the chat could not go on, in words a person reads in Slack, or null when it reached where it was going. */
  stopped: string | null;
  /**
   * Set when the chat ended on a step the shopper takes outside it, which no eval takes: the page where they approve the
   * payment or save a card (`payment`), or the sign-in to their own account at the store (`sign-in`).
   */
  handed: "payment" | "sign-in" | null;
  /** The store's own answer that ended the chat: its own kind of result, never a failure (lib/store-answer.ts). */
  storeAnswer: StoreAnswer | null;
  /**
   * Set when the store asked for the shopper's own account at that store before any cart: how many questions the shopper
   * had already answered since their pick, and what Agentcard said.
   */
  signIn: { questionsBefore: number; optionsBefore: number; said: string } | null;
  /** The cards the shopper picked before the one they picked last, because the store did not sell them in the colour or size asked. */
  switchedFrom: Card[];
  /** Each message the example chat app answered itself, without the buy tool. Counted apart from Agentcard's failures. */
  appMistakes: { said: string; reply: string }[];
  /** True when the example chat app answered so many messages itself that the chat was given up. */
  appGaveUp: boolean;
  /** Why the chat's connection could not be kept, when it dropped and the one retry did not bring an answer. */
  broke: string | null;
  /** The cards the search showed, before the pick. */
  cards: ShownCard[];
  /** Each question a reply asked that it should not have: about something the shopper already said, or one nobody could answer. */
  unfair: string[];
  /** Each time a reply asked again for a detail the shopper had given, without saying why it was not taken. */
  reasked: string[];
  /** Says one more message in the same chat, as `shop` does, for the checkout eval's yes. */
  say: (message: string, afterThePick?: boolean, why?: Step["why"]) => Promise<Step | null>;
}

let sandbox: Promise<boolean> | undefined;

/**
 * True when the evals run with sandbox (test mode) credentials. The cart and checkout evals only run then: in the
 * sandbox Agentcard stops every purchase at the payment, so a yes can never place an order or charge a card.
 */
export function sandboxCredentials(): Promise<boolean> {
  sandbox ??= (async () => {
    const client = new AgentcardClient({ clientId: process.env.AGENTCARD_CLIENT_ID ?? "", clientSecret: process.env.AGENTCARD_CLIENT_SECRET ?? "" });
    await client.bearer();
    return client.sandbox === true;
  })();
  return sandbox;
}

function snapshotOf(turn: EveEvalTurn): Snapshot | null {
  let last: Snapshot | null = null;
  for (const event of turn.events) {
    if (event.type !== "call.progress") continue;
    const output = (event.data as { output?: unknown }).output;
    if (output && typeof output === "object" && "status" in output) last = output as Snapshot;
  }
  return last;
}

/** Every card a turn showed, with what its link says: where it leads, whether it has room, and when it is. */
/** A product link as a turn's snapshot carries it. */
type ProductLink = Snapshot["links"][number];

/**
 * Every card a turn showed, with what its link says: where it leads, whether it has room, and when it is. `seen` holds
 * every product link the chat carried so far, by product id, and takes this turn's: Agentcard sends a card's link only on
 * the turn that first shows the card, so a card shown again later finds its link there. On 2026-11-28 TikTok Shop cards
 * shown a second time were graded as having no store page.
 */
export function shownCards(turn: EveEvalTurn, seen: Map<string, ProductLink> = new Map()): ShownCard[] {
  const snapshot = snapshotOf(turn);
  for (const link of snapshot?.links ?? []) if (link.kind === "product" && link.productId) seen.set(link.productId, link);
  const links = seen;
  return cardsShown(turn).map((card) => {
    const link = card.id === null ? undefined : links.get(card.id);
    let page: ShownCard["page"] = null;
    try {
      if (link?.url) page = CATALOG_HOST.test(new URL(link.url).host) ? "catalog" : "store page";
    } catch {
      // A card whose link cannot be read belongs to neither.
    }
    return { ...card, page, url: link?.url ?? null, availability: link?.availability?.status ?? null, date: (card.id !== null && snapshot?.card_dates?.[card.id]) || null };
  });
}

/** The path a cart is checked out through, in plain words, from the field the app reads. Never shown to a shopper. */
export function checkoutPath(merchant: string | undefined): string {
  if (!merchant) return "unknown";
  if (merchant === "retail") return SUPPLIERS.retail;
  if (merchant.includes(".")) return "the store's own checkout";
  return `Agentcard's ${merchant} service`;
}

/**
 * Logs which path a cart was checked out through, and says so when it is not the one the row expects. Agentcard's code
 * chooses the path, so a change here is news for a person to read, not a failure.
 */
export function logPath(t: EveEvalContext, row: StoreCase, merchant: string | undefined): void {
  const path = checkoutPath(merchant);
  const expected = row.supplier === "retail" ? SUPPLIERS.retail : ["catalog", "shopify", "own site", "used listings", "coffee"].includes(row.supplier) ? "the store's own checkout" : null;
  t.log(`checked out through: ${path}${expected && path !== expected ? ` (note: this row expects ${expected})` : ""}`);
}

const short = (text: string, most = 220) => text.replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").trim().slice(0, most);

type Detail = "name" | "bornOn" | "gender" | "email" | "phone";

/** Each detail as the reply's reader names it (lib/reply-reader.ts), and as a check's message names it. */
const DETAIL_NAMES: Record<ReadDetail, { detail: Detail; words: string }> = {
  name: { detail: "name", words: "name" },
  date_of_birth: { detail: "bornOn", words: "date of birth" },
  gender: { detail: "gender", words: "gender" },
  email: { detail: "email", words: "email" },
  phone: { detail: "phone", words: "phone number" },
};

/** What the shopper has typed and chosen so far in one chat, which decides what they say next. */
interface Said {
  /** Every message sent, and every value chosen or given, so nothing is tried twice. */
  sent: Set<string>;
  /** How often each detail's value was given, so one asked for again is repeated once and no more. */
  gave: Map<string, number>;
  /** The shopper's details: the set they give first, then their other one. */
  contacts: Contact[];
  /**
   * The values already given in answer to each question, by the question's own words. A value is not given twice to the
   * same question, which would loop, and is given again to another one: "M" for a second product's size.
   */
  tried: Map<string, Set<string>>;
  /** The values of the last choice the store listed, such as its colours. */
  options: string[];
  /** Remembers a chosen value, and words the message that carries it as the row asks. */
  choose: (value: string) => string;
  /** Everything the shopper typed so far, one message a line. */
  words: () => string;
  /** Hears a question the reply should not have asked. */
  unfair: (line: string) => void;
  /** Hears a detail the reply asked for again without saying why it was not taken. */
  reasked: (line: string) => void;
  /** Why the shopper cannot answer the last question, when they cannot: the colour or the size they asked for is not offered. */
  cannot?: string;
  /** Set with `cannot` when the reason is that the product picked is not sold in the colour or the size the shopper asked for. */
  notOffered?: true;
  /** The card the shopper picked, once they picked one. */
  picked: () => Card | null;
}

/**
 * The details a reply asks the shopper for, as one message, or null when it asks for none the shopper can still give.
 * Which details it asks for, and whether it says why one was not taken, is its reading (lib/reply-reader.ts).
 *
 * The first time, everything the reply names goes in one message. After that only what the reply still needs: "Thanks,
 * I have your phone. I still need your name." gets the name. A detail asked for again after the shopper gave it gets
 * their other one when they have one (a second phone number), and is otherwise repeated once. Asking again is fair only
 * when the reply says the detail was not taken and why.
 *
 * A detail counts as given once a message that carried it reached Agentcard (`gave` is kept by the sender, not here): a
 * message the example chat app answered itself never got there, so asking for its details is not asking again.
 */
function detailsAskedFor(reply: string, reading: Reading | null, said: Said): string | null {
  const given = (detail: Detail) => said.contacts.some((contact) => said.gave.has(contact[detail]));
  const asked = (reading?.details ?? []).map((one) => DETAIL_NAMES[one]);
  if (asked.length === 0) return null;
  const fresh = asked.filter(({ detail }) => !given(detail));
  const parts: string[] = [];
  for (const { detail, words } of fresh.length > 0 ? fresh : asked) {
    // The first value of this detail not given yet, else the one given before, as long as it was given only once.
    const untried = said.contacts.map((contact) => contact[detail]).find((value) => !said.gave.has(value));
    const value = untried ?? said.contacts.map((contact) => contact[detail]).find((one) => (said.gave.get(one) ?? 0) < 2);
    if (!value) {
      said.cannot = `Agentcard asked once more for the ${words} the shopper had already given twice`;
      continue;
    }
    // Asked again for a detail Agentcard already has: fair only when the reply says it was not taken, and why.
    if (given(detail) && !reading!.refused.some((one) => DETAIL_NAMES[one.detail].detail === detail && one.reasonGiven)) said.reasked(`it asks again for the ${words} the shopper already gave, and does not say why it was not taken: ${short(reply, 160)}`);
    parts.push(value);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * True when the answer shows the final cart and asks for the yes that pays or books it: its next step is the confirm,
 * or its reply asks for that yes in any words, as the reply's reader reads it (lib/reply-reader.ts). Never the yes that
 * confirms an address read back.
 */
export function readyForTheYes(step: Pick<Step, "answer" | "reading"> | null): boolean {
  const answer = step?.answer;
  if (!answer?.cart || answer.status !== "needs_input") return false;
  return answer.next_action === "confirm" || step!.reading?.asks === "pay_or_book";
}

/**
 * True when everything an answer offers is at another store than the one the shopper named, by the answer's own
 * `products` field: each product it lists says which store sells it. The shopper then takes nothing from that reply,
 * whatever its words. Read from the field and never from the reply, because a store's name is often part of a product's:
 * on 2026-11-26 "the Pokémon Pikachu T-Shirt from Amazon" read as an offer at Pokémon Center.
 */
function offeredElsewhere(answer: Answer, row: StoreCase): boolean {
  const stores = (answer.products ?? []).map((product) => product.store).filter(Boolean);
  return row.at !== undefined && stores.length > 0 && !stores.some((store) => row.at!.test(store));
}

/**
 * True when a line of a reply offers something at the store the shopper named, or names no store at all. Only for an
 * answer that lists no products to read the store from. The store is read from the words that say where ("at Walmart",
 * "from Amazon"), never from the rest of the line, where a product's own name can hold a store's. A line that offers a
 * product at another store is never the shopper's pick: on 2026-11-26 an eval that asked at one store answered
 * "…$10.95 at Walmart" from a list and built a Walmart cart.
 */
/** Words that say where something is sold: "at Walmart", "from Amazon". */
const STORE_NAMED = /\b(?:at|from|on|via)\s+(?:the\s+)?(?!(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|Mon|Tue|Wed|Thu|Fri|Sat|Sun|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\b)[A-Z][\w&'’.-]*/;

function atNamedStore(line: string, row: StoreCase): boolean {
  if (!row.at) return true;
  const named = [...line.matchAll(/\b(?:at|from|on|via)\s+(?:the\s+)?(?!(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|Mon|Tue|Wed|Thu|Fri|Sat|Sun|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\b)([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,2})/g)].map((found) => found[1]!);
  return named.length === 0 || named.some((store) => row.at!.test(store));
}

/**
 * What the shopper says next, or null when the reply asks for nothing this shopper can give.
 *
 * The answer's own fields come first: its `choice`, its `next_action`, its `products` and their stores. What is left to
 * read in the reply's words (what it asks, which details, which choices it lists in words, which value fits the shopper's
 * ask, where an offered product is sold) is its reading by a model (lib/reply-reader.ts), never a list of words.
 */
function nextMessage(answer: Answer, reading: Reading | null, row: StoreCase, said: Said): string | null {
  const reply = answer.reply;
  const asks = reading?.asks ?? null;
  said.cannot = undefined;
  said.notOffered = undefined;
  const { sent, choose } = said;
  const address = row.address ?? said.contacts[0]!.address;
  // The shopper only buys at the store they named. An answer whose every product is at another store offers nothing
  // they take: no yes, no pick from a list.
  const elsewhere = offeredElsewhere(answer, row);
  const atNamed = (store: string | null) => !row.at || store === null || row.at.test(store);
  // What was already answered to this very question, so the same value is never given to it twice.
  const question = (answer.choice?.question ?? reply).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  const tried = said.tried.get(question) ?? new Set<string>();
  said.tried.set(question, tried);
  const give = (value: string) => {
    tried.add(value);
    return choose(value);
  };

  // A choice the product has, such as a size or a taco's filling: from the answer's `choice` field, else as the reply
  // lists it. The shopper gives the value that fits their ask ("Jet Black" for black), else the first that can be had.
  // A shopper who asked for a colour or a size takes no other: when none of the values fits it, they have nothing to
  // answer here, and pick another card that fits instead (see `shop`). Choices nobody could answer, such as several with
  // placeholders for names, are not answered: the chat ends there, with that as its reason (lib/questions.ts).
  const groups: Group[] = answer.choice?.groups.length ? answer.choice.groups : (reading?.choices ?? []).map((choice) => ({ name: choice.name, required: true, options: choice.values.filter((value) => !choice.unavailable.includes(value)) }));
  if (groups.length > 0) {
    if (placeholderNames(groups).length > 0) return null;
    const required = groups.filter((group) => group.required);
    const answering = required.length > 0 ? required : groups.slice(0, 1);
    const values: string[] = [];
    for (const group of answering) {
      const fit = reading?.fits.find((one) => one.choice.toLowerCase() === group.name.toLowerCase());
      if (fit && fit.value === null) {
        said.cannot = `the product the shopper picked is not offered as they asked for ${group.name}: the store lists ${group.options.map(valueOf).slice(0, 8).join(", ") || "nothing that can be had"}. Agentcard said: ${short(reply, 200)}`;
        said.notOffered = true;
        return null;
      }
      const value = fit?.value ?? group.options.map(valueOf).find((one) => one && !tried.has(one));
      if (value) values.push(value);
    }
    const message = values.join(", ");
    if (message && !tried.has(message)) return give(message);
  }
  // The address read back: "Is it 1 Ferry Plz, San Francisco, CA 94111? Say yes, or send me the right address."
  if (asks === "confirm_address") return row.kind === "booking" ? null : "yes";
  // The details a booking or a guest checkout asks for.
  if (answer.next_action === "guest_details" || (reading?.details.length ?? 0) > 0) {
    const details = detailsAskedFor(reply, reading, said);
    if (details) return details;
  }
  if (answer.next_action === "shipping_details" || asks === "address") return sent.has(address) ? null : address;
  if (asks === "as_listed") return "as it comes";
  // How many: the number the shopper asked for. A question about a number they already gave is counted unfair from the
  // reading (`alreadySaid`), with every other such question.
  if (asks === "how_many" && !answer.cart) {
    const count = String(row.quantity ?? 1);
    if (!sent.has(count)) return choose(count);
  }
  // "Want me to add it to your cart?", or the same product at the price the store now shows: yes, while no cart exists.
  // This is never the yes that pays, which is only asked for over a cart. A booking too: "Do you want me to add the King
  // Room?" holds the room with its price, and books nothing (2026-11-27, a hotel run ended on this question).
  // An offer at another store than the one the shopper named is never taken: the chat then ends with no card at the
  // named store, which is what happened.
  if (!answer.cart && asks === "add_to_cart") return !elsewhere && atNamed(reading?.offerAt ?? null) ? "yes" : null;
  // "I couldn't get through the checkout. Want me to try it again?": a shopper says yes, once. A second failure ends the chat.
  if (!answer.cart && asks === "try_again" && !sent.has("yes, try again")) return "yes, try again";
  // "Which one do you want?" among products: the card the shopper picked, by its name alone, which is never ambiguous;
  // else the first one at the store they named that fits their ask, by its number. From the answer's `products` field
  // when it has one; whether a product fits the ask is its reading (a tee offered in another colour than asked does not).
  const fitsTheAsk = (name: string) => reading?.products.find((product) => product.name.toLowerCase() === name.toLowerCase())?.fitsTheAsk !== false;
  const offered = answer.products?.length ? answer.products.map((product, index) => ({ number: index + 1, name: product.name, store: product.store, fitsTheAsk: fitsTheAsk(product.name) })) : (reading?.products ?? []);
  if (!answer.cart && !elsewhere && offered.length > 1 && (asks === "other_question" || asks === "product_option")) {
    const picked = said.picked();
    if (picked && offered.some((product) => product.name.toLowerCase().includes(picked.name.toLowerCase().slice(0, 40))) && !sent.has(picked.name)) {
      sent.add(picked.name);
      return picked.name;
    }
    const first = offered.find((product) => atNamed(product.store) && product.fitsTheAsk);
    if (first?.number && !sent.has(`number ${first.number}`)) return `number ${first.number}`;
  }
  // "What size would you like?" with no values listed: a question about a choice the product has, which is fair and gets
  // an answer, never the end of the chat. The shopper gives the size or the colour their ask named, else the one a person
  // with no preference would name.
  if (asks === "product_option" && groups.length === 0) {
    const value = [row.size, row.color].filter(Boolean).join(", ") || "medium";
    if (!sent.has(value)) return choose(value);
  }
  return null;
}

/**
 * True when an answer is not the answer yet: Agentcard is still working on the shopper's last message. Read from the
 * answer's fields first (the call was cut short while the turn went on, a second message arrived while it ran, or the
 * store's checkout is still building the cart), and from the reply's words when it carries none of them. An empty reply
 * counts too: the shopper was told nothing, so they wait.
 */
export function stillWorking(step: Step): boolean {
  const answer = step.answer;
  if (!answer || answer.status !== "needs_input" || answer.cart?.items.length) return false;
  const code = step.snapshot?.error_code;
  if (code === "turn_timeout" || code === "turn_in_progress" || step.snapshot?.turn_continues === true || answer.cart_building) return true;
  if (answer.reply.trim() === "") return true;
  return step.reading?.stillWorking === true && step.reading.asks === "nothing";
}

/**
 * Plays the shopper for one row: asks, picks a card, then answers the checkout's questions until `goal` is reached.
 * `cart` stops as soon as the product is in a cart. `checkout` goes on until Agentcard shows the final cart and asks
 * for the yes. It never says yes to a cart itself; the checkout eval does that, for goods only.
 *
 * How a chat can end, and where each ending is kept:
 * - It reached the goal: nothing is set.
 * - Agentcard could not go on, or asked for something no eval can give: the reason is in `stopped`, which the eval
 *   reports as that store's failure.
 * - The store's own answer (out of stock, another price, no seats, slow to price): `storeAnswer`, its own kind of result.
 * - The store wants the shopper's own account before any cart: `signIn`, which is the store's own answer when the
 *   sign-in came first and the evals have no test account at that store (see `checkChat`).
 * - The example chat app kept answering the shopper itself: `appGaveUp`. Each time it did is in `appMistakes`.
 * - The connection dropped and the one retry did not bring an answer: `broke`.
 */
export async function shop(t: EveEvalContext, row: StoreCase, goal: "cart" | "checkout", budgetMs = 600_000, from?: EveEvalTurn["session"]): Promise<Purchase> {
  const started = Date.now();
  const purchase: Purchase = { steps: [], picked: null, stopped: null, handed: null, storeAnswer: null, signIn: null, switchedFrom: [], appMistakes: [], appGaveUp: false, broke: null, cards: [], unfair: [], reasked: [], say: async () => null };
  // A chat already under way goes on in its own session, so what the shopper said before still stands.
  let session: EveEvalTurn["session"] | undefined = from;
  // Where the chat's stream stood before the last message went out, so a dropped connection can read on from there.
  let before = 0;
  const said: Said = {
    sent: new Set<string>(),
    gave: new Map<string, number>(),
    contacts: contactsOf(row),
    tried: new Map<string, Set<string>>(),
    options: [],
    // A value the shopper chooses is remembered as the value, however the row words the message that carries it.
    choose: (value) => {
      said.sent.add(value);
      return row.choiceAs ? row.choiceAs(value, purchase.picked) : value;
    },
    words: () => purchase.steps.map((step) => step.said).join("\n"),
    picked: () => purchase.picked,
    unfair: (line) => purchase.unfair.push(`after "${short(purchase.steps.at(-1)?.said ?? "", 60)}" ${line}`),
    reasked: (line) => purchase.reasked.push(`after "${short(purchase.steps.at(-1)?.said ?? "", 60)}" ${line}`),
  };
  const sent = said.sent;

  const chat: Chat<EveEvalTurn> = {
    open: (message) => t.send(message),
    send: (message) => {
      before = session!.state.streamIndex;
      return session!.send(message);
    },
    // The chat shows every message it took in, the moment it takes it in (`delivery.admitted`), even while an earlier
    // turn still runs. One that never arrived shows nothing, and is not sent again.
    readAgain: async () => {
      const again = t.target.attach(session!.id, { startIndex: before });
      const live = again.watch();
      const arrived = await Promise.race([live.waitForEvent("delivery.admitted").then(() => true, () => false), t.sleep(ARRIVES_WITHIN_MS).then(() => false)]);
      return arrived ? await live.result() : null;
    },
  };

  /** Sends one message and reads what came back. `app` is true when the example chat app answered it itself, without the buy tool. */
  const sendOnce = async (message: string, afterThePick: boolean, why?: Step["why"]): Promise<{ step: Step | null; app: boolean }> => {
    sent.add(message);
    let turn: EveEvalTurn;
    try {
      turn = await deliver(chat, message, session === undefined, (line) => t.log(line));
    } catch (error) {
      purchase.broke = `after the shopper said "${short(message, 80)}": ${short(error instanceof ChatBroke || error instanceof Error ? error.message : String(error))}`;
      return { step: null, app: false };
    }
    session = turn.session;
    const answer = lastAnswer(turn) as Answer | null;
    // Earlier totals and the picked card's price, which a reply may compare against.
    const earlier = [...new Set([...purchase.steps.map((one) => one.answer?.cart?.total).filter((total): total is string => Boolean(total)), ...(purchase.picked?.price ? [purchase.picked.price] : [])])];
    const shopper = [...purchase.steps.map((one) => one.said), message];
    const choiceField = answer?.choice?.groups.map((group) => ({ name: group.name, options: group.options.map(valueOf) }));
    const reading = answer && buyCalls(turn).length > 0 ? await readReply({ reply: answer.reply, cart: answer.cart, nextAction: answer.next_action, earlier, shopper, ...(choiceField?.length ? { choiceField } : {}) }, (line) => t.log(line)) : null;
    const step: Step = { said: message, turn, answer, snapshot: snapshotOf(turn), reading, ...(why ? { why } : {}) };
    purchase.steps.push(step);
    // The ask and the pick must not confirm. A refusal is reported once, as the reason the chat stopped or as the store's
    // own answer, so it is not also counted here.
    checkTurn(t, turn, afterThePick, true);
    checkWordsUnchanged(t, turn, message);
    const cart = step.answer?.cart;
    t.log(`shopper: ${short(message, 120)}`);
    t.log(`  Agentcard (${step.answer?.status ?? "no answer"}, next: ${step.answer?.next_action ?? "none"}${step.snapshot?.decline_code ? `, stopped: ${step.snapshot.decline_code}` : ""}${step.snapshot?.error_code ? `, error: ${step.snapshot.error_code}` : ""}, links: ${(step.answer?.links_sent ?? []).join(", ") || "none"}): ${short(step.answer?.reply ?? turn.reply ?? "")}`);
    if (cart) t.log(`  cart at ${cart.store}: ${cart.items.map((item) => `${item.qty} x ${short(item.name, 60)} (${item.price ?? "no price"})`).join("; ")}; total ${cart.total}${cart.total_is_estimate ? " (estimate)" : ""}; checked out through ${checkoutPath(step.snapshot?.carts.at(-1)?.merchant)}`);
    t.log(RECORD + JSON.stringify({ shopper: message, cards: purchase.steps.length === 1 ? cardsShown(turn).map((card) => ({ name: card.name, store: card.store, price: card.price })) : [], agentcard_reply: step.answer?.reply ?? "", agent_reply: turn.reply ?? "", cart: cart ?? null, wants: [] }));
    const failed = buyCalls(turn).find((call) => call.status !== "completed");
    if (failed) {
      purchase.stopped = `the buy tool's call ${failed.status}: ${short(typeof failed.output === "string" ? failed.output : JSON.stringify(failed.output ?? ""))}`;
      return { step: null, app: false };
    }
    if (buyCalls(turn).length === 0) return { step: null, app: true };
    if (!step.answer) {
      purchase.stopped = `the buy tool's answer could not be read after the shopper said "${short(message, 80)}"`;
      return { step: null, app: false };
    }
    // The buy tool answered, so this message reached Agentcard: the details it carried now count as given.
    // Each value once, however many of the shopper's sets hold it: both sets have the same name and date of birth.
    const values = new Set(said.contacts.flatMap((contact) => [contact.name, contact.bornOn, contact.email, contact.phone]));
    for (const value of values) if (message.includes(value)) said.gave.set(value, (said.gave.get(value) ?? 0) + 1);
    if (message.split(/,\s*/).includes(said.contacts[0]!.gender)) said.gave.set(said.contacts[0]!.gender, (said.gave.get(said.contacts[0]!.gender) ?? 0) + 1);
    // Every question an answer asks is held against what the shopper has already said: choices with placeholders for
    // names nobody can answer (lib/questions.ts), and questions about something the shopper already settled, as the
    // reply's reading finds them. A question about something they asked for that cannot be had is fair.
    const groups = step.answer.choice?.groups.length ? step.answer.choice.groups : (step.reading?.choices ?? []).map((choice) => ({ name: choice.name, required: true, options: choice.values }));
    for (const line of placeholderNames(groups)) purchase.unfair.push(`after "${short(message, 60)}" ${line}`);
    for (const asked of step.reading?.alreadySaid ?? []) purchase.unfair.push(`after "${short(message, 60)}" it asks ${short(asked, 120)}, which the shopper already said`);
    return { step, app: false };
  };

  /** Counts one message the example chat app answered itself. False once it has done so too often to go on. */
  const appAnswered = (): boolean => {
    const last = purchase.steps.at(-1)!;
    purchase.appMistakes.push({ said: short(last.said, 120), reply: short(last.turn.reply ?? "", 300) });
    t.log(`the example chat app answered "${short(last.said, 60)}" itself, without the buy tool: ${short(last.turn.reply ?? "")}`);
    if (purchase.appMistakes.length < 3) return true;
    purchase.appGaveUp = true;
    return false;
  };

  const say: Purchase["say"] = async (message, afterThePick = false, why) => {
    const step = await sayAndWait(message, afterThePick, why);
    // A store that closed its checkout for now, or an item no longer available, ends the chat as the store's own answer
    // once Agentcard says so and offers a way on, even when the same answer already moved the item to another store's
    // cart: that cart is Agentcard's next step for the shopper, not the store they named (lib/store-answer.ts).
    if (step?.answer) {
      const gone = closedOrGoneOf({ code: codeOf(step), reply: step.answer.reply, said: step.reading?.storeSays, offersNextStep: step.reading?.offersNextStep });
      if (gone) {
        purchase.storeAnswer = gone;
        return null;
      }
    }
    return step;
  };
  const sayAndWait = async (message: string, afterThePick: boolean, why?: Step["why"]): Promise<Step | null> => {
    let { step, app } = await sendOnce(message, afterThePick, why);
    // The example chat app answered the shopper itself. Agentcard never got the message, so the shopper types the same
    // message once more: it reaches Agentcard once, and the rest of the chat is still checked.
    while (app) {
      if (!appAnswered()) return null;
      ({ step, app } = await sendOnce(message, afterThePick, "said again"));
    }
    // "Still working" is not the answer. The shopper waits and asks for an update, until the late result arrives, and
    // the chat fails only when none ever does.
    let waited = 0;
    while (step && stillWorking(step)) {
      if (waited >= LATE_RESULT_WITHIN_MS || Date.now() - started > budgetMs + LATE_RESULT_WITHIN_MS) {
        purchase.stopped = `Agentcard was still working ${Math.round(waited / 60_000)} minutes after the shopper said "${short(message, 60)}", and no result ever arrived. It last said: ${short(step.answer?.reply ?? "") || "(nothing)"}`;
        return null;
      }
      const sentAt = Date.now();
      await t.sleep(WAIT_BETWEEN_MS);
      const next = await sendOnce(ANY_UPDATE, true, "waiting");
      waited += Date.now() - sentAt;
      // The app answering "no update yet" itself is its own mistake, and the shopper goes on waiting.
      if (next.app) {
        if (!appAnswered()) return null;
        continue;
      }
      step = next.step;
    }
    return step;
  };
  purchase.say = say;

  const reached = (step: Step) => (goal === "cart" ? Boolean(step.answer?.cart?.items.length) : readyForTheYes(step));
  const codeOf = (step: Step) => step.snapshot?.decline_code ?? step.snapshot?.error_code ?? null;

  let step = await say(row.ask);
  if (!step) return purchase;

  // A card is picked only when it is the product, at the store the shopper named, with a price to pay (a table is free),
  // with room when it says whether it has any, for the days asked, and not in another colour or size than asked.
  // Every product link the chat carried so far, by product id (see `shownCards`).
  const linksSeen = new Map<string, ProductLink>();
  for (const earlier of purchase.steps) shownCards(earlier.turn, linksSeen);
  const fits = (card: ShownCard) =>
    row.product.test(card.name) &&
    (row.free === true || dollars(card.price) !== null) &&
    (row.maxPrice === undefined || (dollars(card.price) ?? 0) <= row.maxPrice) &&
    (!row.at || (card.store !== null && row.at.test(card.store))) &&
    card.availability !== "unavailable" &&
    (!row.window || cardDays({ field: card.date, page: card.url, name: card.name }).days.every((day) => inWindow(day, row.window!))) &&
    (!row.color || !namesAnotherColor(card.name, row.color)) &&
    (!row.size || !namesAnotherSize(card.name, row.size));
  // A row that names a supplier's cards takes only those. Any other row takes the first card that is the product, one
  // that names the colour asked for before one that names none, and one that opens the store's own page before one from
  // the catalog. Cards already picked and not sold as asked are left out.
  const choose = (cards: ShownCard[]): ShownCard | undefined => {
    const open = cards.filter((card) => !purchase.switchedFrom.some((before) => before === card || (before.id !== null && before.id === card.id)) && card !== purchase.picked);
    const ranked = row.color ? [...open.filter((card) => showsColor(card.name, row.color!)), ...open.filter((card) => !showsColor(card.name, row.color!))] : open;
    return row.cards ? ranked.find((card) => fits(card) && card.page === row.cards) : (ranked.find((card) => fits(card) && card.page === "store page") ?? ranked.find(fits));
  };

  // Pick a card, unless an answer already put the product in a cart. A question that comes before any card is answered
  // first: the delivery address for food, or "want me to add it to your cart?" when the reply names the product and
  // shows no card for it.
  for (let asked = 0; asked < 4 && !step.answer?.cart && !purchase.picked; asked++) {
    const cards = shownCards(step.turn, linksSeen);
    if (cards.length > 0) purchase.cards = cards;
    // A booking whose search found nothing bookable in the dates asked says so in its code, which is read first.
    if (row.kind === "booking" && noRoomByCode(codeOf(step))) {
      purchase.storeAnswer = storeAnswerOf({ code: codeOf(step), reply: step.answer?.reply ?? "", said: step.reading?.storeSays, offersNextStep: step.reading?.offersNextStep, booking: true });
      return purchase;
    }
    const pick = choose(cards);
    if (pick) {
      purchase.picked = pick;
      break;
    }
    const seen = cards.map((card) => `${short(card.name, 50)} (${card.store ?? "no store"}, ${card.price ?? "no price"}, ${card.id ? (card.page ?? "no page") : "no id"}${card.availability ? `, ${card.availability}` : ""})`);
    const ofTheProduct = cards.filter((card) => row.product.test(card.name));
    // Cards that all say they have no room, or show no price to book at, are the store's own answer already.
    const noRoom = ofTheProduct.length > 0 ? storeAnswerOf({ code: null, reply: "", booking: row.kind === "booking", cards: ofTheProduct, free: row.free }) : null;
    const question = !noRoom && !row.cards && step.answer ? nextMessage(step.answer, step.reading, row, said) : null;
    if (!question) {
      const own = noRoom ? { ...noRoom, said: short(step.answer?.reply ?? "", 300) } : storeAnswerOf({ code: codeOf(step), reply: step.answer?.reply ?? "", said: step.reading?.storeSays, offersNextStep: step.reading?.offersNextStep, booking: row.kind === "booking", cards: ofTheProduct, free: row.free });
      if (own) {
        purchase.storeAnswer = own;
        return purchase;
      }
      purchase.stopped = row.cards
        ? `no card for the asked product came from the ${SUPPLIERS[row.supplier]} (${row.cards === "catalog" ? "a card that opens the catalog's link" : "a card that opens the store's own page"}). Cards shown: ${seen.join("; ") || "none"}. Agentcard said: ${short(step.answer?.reply ?? "")}`
        : `no card shown is the asked product at the asked store${row.color ? `, in ${row.color} or with no colour named` : ""}${row.size ? `, in size ${row.size} or with no size named` : ""}, ${row.maxPrice === undefined ? "with a price" : `under $${row.maxPrice}`}${row.window ? `, for ${row.window.words}` : ""}. Cards shown: ${seen.join("; ") || "none"}. Agentcard said: ${short(step.answer?.reply ?? "")}`;
      return purchase;
    }
    step = await say(question);
    if (!step) return purchase;
  }
  let pickedAt = 0;
  if (purchase.picked && !step.answer?.cart) {
    t.log(`picking: ${purchase.picked.name} (${purchase.picked.store}, ${purchase.picked.price})`);
    // The card's place in the list the model reads goes first, so two cards with one name and price are told apart.
    const place = ((lastAnswer(step.turn)?.products ?? []) as { product_id: string | null }[]).findIndex((product) => product.product_id === purchase.picked!.id) + 1;
    pickedAt = purchase.steps.length;
    step = await say(`I want ${place > 0 ? `number ${place}` : "this one"}: ${purchase.picked.name}${purchase.picked.price ? `, ${purchase.picked.price}` : ""}`);
    if (!step) return purchase;
    // Whether the agent also passed the card's id is only logged: the cart checks below decide whether the pick landed.
    const ids = buyCalls(step.turn).map((call) => call.input.product_id);
    t.log(`the agent passed the picked card's id: ${ids.includes(purchase.picked.id) ? "yes" : `no (it passed: ${ids.join(", ") || "none"})`}`);
  }

  // Answer what the checkout asks, a few messages at most. Waiting for a store's total is not an answer, and has its own limit.
  let pricingSince: number | null = null;
  const waitedForPrice: Step[] = [];
  for (let asked = 0; asked < 10 && !reached(step); ) {
    const answer = step.answer!;
    const code = codeOf(step);
    // A step the shopper takes outside the chat ends it here: no eval opens a payment page or signs in to a store.
    const links = answer.links_sent ?? [];
    if ((answer.status === "approval_sent" && links.includes("approval")) || (answer.status === "needs_card" && links.includes("vault"))) {
      purchase.handed = "payment";
      return purchase;
    }
    if (needsAccount({ code, nextAction: answer.next_action, links })) {
      purchase.handed = "sign-in";
      // Before any cart, the store wants the shopper's own account there. What that means is decided in `checkChat`.
      if (!cartStep(purchase)) {
        // The questions the shopper answered before the sign-in, other than the product's own options (its size or its
        // colour), which Agentcard asks first on purpose so the sign-in's checkout can carry on with them. Each message
        // answered the answer just before it.
        const answered = purchase.steps.map((one, index) => ({ one, question: purchase.steps[index - 1] })).slice(pickedAt + 1).filter(({ one }) => one.why === undefined);
        const productOption = (question: Step | undefined) => Boolean(question?.answer?.choice?.groups.length) || question?.reading?.asks === "product_option";
        const others = answered.filter(({ question }) => !productOption(question));
        purchase.signIn = { questionsBefore: others.length, optionsBefore: answered.length - others.length, said: short(answer.reply, 300) };
      }
      return purchase;
    }
    if (row.kind === "booking" && noRoomByCode(code)) {
      purchase.storeAnswer = storeAnswerOf({ code, reply: answer.reply, said: step.reading?.storeSays, offersNextStep: step.reading?.offersNextStep, booking: true });
      return purchase;
    }
    const storeSays = step.reading?.storeSays;
    const wayOn = step.reading?.offersNextStep;
    const own = () => storeAnswerOf({ code, reply: answer.reply, said: storeSays, offersNextStep: wayOn, booking: row.kind === "booking", priceChanged: Boolean(answer.cart?.price_change) && answer.status === "declined" });
    if (["declined", "needs_card", "approval_sent", "placing", "order_placed"].includes(answer.status)) {
      purchase.storeAnswer = answer.status === "declined" ? own() : null;
      // A store closed for now, or an item no longer available, with no way on offered: the shopper is left with nothing
      // to do, which is Agentcard's to fix (another store with the same item, or when the store opens again).
      const stuck = /^(checkout_closed|store_closed)$/.test(code ?? "") || storeSays === "checkout_closed" || storeSays === "no_longer_available";
      if (!purchase.storeAnswer)
        purchase.stopped = stuck
          ? `${storeSays === "no_longer_available" ? "the item is no longer available" : "the store's checkout is closed for now"}, and Agentcard offered no way on: no other store with the same item, and no time to try again${code ? ` (${code})` : ""}. Agentcard said: ${short(answer.reply)}`
          : `Agentcard stopped with "${answer.status}"${code ? ` (${code})` : ""} before ${goal === "cart" ? "a cart existed" : "the purchase was ready to pay"}: ${short(answer.reply)}`;
      return purchase;
    }
    // The store is still pricing the cart, and nothing asks the shopper anything: they wait for its total, asking for an
    // update every half minute, as the checkout eval does after the yes. The wait has its own limit, not the chat's.
    const asksAnything = (step.reading !== null && step.reading.asks !== "nothing") || (answer.choice?.groups.length ?? 0) > 0 || (answer.next_action !== null && answer.next_action !== "none");
    const offersToWait = step.reading?.asks === "keep_waiting_or_another_store" && Boolean(answer.cart?.items.length);
    if (goal === "checkout" && !readyForTheYes(step) && (offersToWait || (stillPricing(step) && !asksAnything))) {
      pricingSince ??= Date.now();
      waitedForPrice.push(step);
      if (Date.now() - pricingSince > PRICING_WITHIN_MS) {
        purchase.storeAnswer = slowToPrice(waitedForPrice, Date.now() - pricingSince, "before the yes");
        if (!purchase.storeAnswer) purchase.stopped = `the store had still not priced the cart ${Math.round((Date.now() - pricingSince) / 60_000)} minutes later, and Agentcard did not keep the shopper told and offer to keep waiting or to try another store. It last said: ${short(answer.reply, 240)}`;
        return purchase;
      }
      await t.sleep(30_000);
      step = await say(offersToWait ? "keep waiting" : ANY_UPDATE, true, "waiting");
      if (!step) return purchase;
      continue;
    }
    pricingSince = null;
    waitedForPrice.length = 0;
    asked++;
    if (Date.now() - started > budgetMs) {
      purchase.stopped = `out of time after ${Math.round((Date.now() - started) / 60_000)} minutes, still not ${goal === "cart" ? "in a cart" : "ready to pay"}. Agentcard last said: ${short(answer.reply)}`;
      return purchase;
    }
    const message = nextMessage(answer, step.reading, row, said);
    if (!message) {
      // The product picked is not sold in the colour or the size the shopper asked for: a person picks another card that
      // fits from those they were shown, and the chat goes on with it. It fails only when no other card fits.
      const other = said.notOffered && purchase.picked && purchase.switchedFrom.length < 2 ? choose(purchase.cards) : undefined;
      if (other) {
        t.log(`the store does not sell "${short(purchase.picked!.name, 60)}" as asked, so the shopper picks another card: ${short(other.name, 60)} (${other.store}, ${other.price})`);
        purchase.switchedFrom.push(purchase.picked!);
        purchase.picked = other;
        step = await say(`That one doesn't come in what I asked for. I'll take this one instead: ${other.name}${other.price ? `, ${other.price}` : ""}`, true);
        if (!step) return purchase;
        continue;
      }
      purchase.storeAnswer = own();
      if (!purchase.storeAnswer) purchase.stopped = `${said.cannot ?? "the checkout asked for something this shopper cannot give, or said nothing to answer"}${said.notOffered ? `, and no other card shown fits the ask${purchase.switchedFrom.length ? ` (the shopper had already switched from ${purchase.switchedFrom.map((card) => `"${short(card.name, 50)}"`).join(", ")})` : ""}` : ""}${code ? ` (${code})` : ""}. Agentcard said: ${short(answer.reply, 300)}`;
      return purchase;
    }
    step = await say(message, true);
    if (!step) return purchase;
  }
  if (!reached(step) && !purchase.handed) purchase.stopped = `still not ${goal === "cart" ? "in a cart" : "ready to pay"} after ${purchase.steps.length} messages. Agentcard last said: ${short(step.answer?.reply ?? "", 300)}`;
  return purchase;
}

/**
 * True when the chat ended for a reason that is not Agentcard failing to get there: the store's own answer, a sign-in
 * before any cart, the example chat app answering by itself, or a dropped connection. Each has its own checks in
 * `checkChat`, so an eval that sees one of these does not also report "the product never got into a cart".
 */
export function endedElsewhere(purchase: Purchase): boolean {
  return purchase.storeAnswer !== null || purchase.signIn !== null || purchase.appGaveUp || purchase.broke !== null;
}

/**
 * True when the answer says the store has not sent its final total yet, so nothing can be paid for now. Read from the
 * cart's field first (`pricing`), and from the reply's reading when the cart carries none (lib/reply-reader.ts): on
 * 2026-11-26 "Still waiting. The store has been pricing your order for about 3 minutes." carried no field.
 */
export function stillPricing(step: Pick<Step, "answer" | "reading"> | null): boolean {
  const answer = step?.answer;
  if (answer?.status !== "needs_input" || !answer.cart) return false;
  if (answer.cart.pricing === true) return true;
  return step!.reading?.pricing === "still_pricing";
}

/** How long the shopper waits for a store to price their order, asking for an update every half minute. */
export const PRICING_WITHIN_MS = 10 * 60_000;

/** True when the reply offers to keep waiting for the store's total or to buy elsewhere, which a shopper who waits answers "keep waiting". */
export function offersToKeepWaiting(step: Pick<Step, "reading"> | null): boolean {
  return step?.reading?.asks === "keep_waiting_or_another_store";
}

/**
 * The store's own answer "the store was slow to price", when a store sent no total in the time the shopper waited and
 * Agentcard kept them told all along: every answer while they waited said something, and one offered to keep waiting or
 * to try another store. Null when Agentcard left the shopper with nothing to go on, which stays a failure, or when the
 * last answer is not a store still pricing or unable to price. `steps` are the answers the shopper read while waiting.
 */
export function slowToPrice(steps: readonly Pick<Step, "answer" | "reading">[], waitedMs: number, when: "before the yes" | "after the yes"): StoreAnswer | null {
  const read = steps.filter((step) => step.answer !== null);
  const last = read.at(-1);
  if (!last) return null;
  if (!stillPricing(last) && !offersToKeepWaiting(last) && last.reading?.pricing !== "could_not_price") return null;
  const told = read.every((step) => step.answer!.reply.trim() !== "") && read.some(offersToKeepWaiting);
  if (!told) return null;
  return {
    what: "the store was slow to price",
    read_from: last.answer!.cart?.pricing === true ? "the answer's fields" : "the reply's words",
    said: `${short(last.answer!.reply, 260)} (no total from the store ${Math.round(waitedMs / 60_000)} minutes into the wait, ${when})`,
  };
}

/** The last step of the chat that shows a cart. */
export function cartStep(purchase: Purchase): Step | null {
  return [...purchase.steps].reverse().find((step) => Boolean(step.answer?.cart?.items.length)) ?? null;
}

/** Fails the eval with the reason the chat stopped, as one named check, so a store that is down reads as its own failure. */
export function checkReached(t: EveEvalContext, purchase: Purchase, label: string, what: string): boolean {
  t.check(purchase.stopped, satisfies((stopped: string | null) => stopped === null, purchase.stopped ? `${what}: ${purchase.stopped}` : what)).label(label);
  return purchase.stopped === null;
}

const cents = (price: string | null | undefined): number | null => {
  const amount = dollars(price ?? null);
  return amount === null ? null : Math.round(amount * 100);
};
const money = (amount: number) => `$${(amount / 100).toFixed(2)}`;

/**
 * The cart holds exactly what the shopper picked, at the store they named, in the size and the colour they asked for,
 * with a price that multiplies out to the store's subtotal and a total that adds up. Every rule here is fixed: no model
 * judges a cart.
 */
export function checkCart(t: EveEvalContext, row: StoreCase, purchase: Purchase, step: Step): void {
  const cart = step.answer!.cart!;
  const raw = step.snapshot?.carts.at(-1);
  const lines = cart.items.map((item) => `${item.qty} x ${short(item.name, 70)}`).join("; ");
  if (row.at) t.check(cart.store, satisfies((store: string) => row.at!.test(store), `the cart is at ${row.store} (it is at ${cart.store})`)).label("cart-at-named-store");
  t.check(cart.items, satisfies((items: Cart["items"]) => items.length === 1, `the cart holds one line (it holds: ${lines})`)).label("cart-holds-one-line");
  const line = cart.items[0];
  if (!line) return;
  const picked = purchase.picked;
  const sameProduct = (picked?.id != null && (line.product_id === picked.id || (line.other_product_ids ?? []).includes(picked.id))) || row.product.test(line.name);
  t.check(sameProduct, satisfies((same: boolean) => same, `the cart's line is the product the shopper picked (picked: ${short(picked?.name ?? row.ask, 70)}; in the cart: ${short(line.name, 70)})`)).label("cart-holds-the-pick");
  t.check(line.qty, satisfies((qty: number) => qty === (row.quantity ?? 1), `the cart holds ${row.quantity ?? 1} of it, as asked (it holds ${line.qty})`)).label("cart-asked-quantity");
  // The size and the colour the shopper asked for, as the line shows them: in its name, its variant or its options.
  const shows = [line.name, line.variant ?? "", ...(line.options ?? [])].filter(Boolean).join(" · ");
  if (row.size) t.check(shows, satisfies((text: string) => showsSize(text, row.size!), `the cart's line shows the size asked for, ${row.size} (it shows: ${short(shows, 160)})`)).label("cart-shows-asked-size");
  if (row.color) t.check(shows, satisfies((text: string) => showsColor(text, row.color!), `the cart's line shows the colour asked for, ${row.color} (it shows: ${short(shows, 160)})`)).label("cart-shows-asked-color");
  if (!row.free) {
    // A line the store prices only inside the cart's total says so (`price_in_total`, Commerce SDK 0.35.0), and counts as priced.
    t.check(line.price, satisfies((price: string | null) => (dollars(price) ?? 0) > 0 || line.price_in_total === true, `the cart's line shows a price, or says the store prices it only inside the total (it shows ${line.price ?? "none"})`)).label("cart-line-priced");
    t.check(cart.total, satisfies((total: string) => (dollars(total) ?? 0) > 0, `the cart shows a total (it shows ${cart.total})`)).label("cart-has-total");
  }
  // One unit's price times the quantity is the store's subtotal: the store's own order summary where Agentcard read it,
  // else the subtotal the cart carries. A line with add-ons, such as a burger's extra patty, is held to its own line total.
  const fromSummary = cents(cart.breakdown?.subtotal);
  const subtotal = fromSummary ?? raw?.subtotalCents ?? null;
  const priced = cart.items.map((item) => ({ unit: cents(item.price), whole: cents(item.line_total), qty: item.qty }));
  if (subtotal !== null && priced.every((item) => item.unit !== null)) {
    const byUnits = priced.reduce((sum, item) => sum + item.unit! * item.qty, 0);
    const byLines = priced.every((item) => item.whole !== null) ? priced.reduce((sum, item) => sum + item.whole!, 0) : null;
    const addOns = cart.items.some((item) => (item.options ?? []).length > 0);
    const worked = cart.items.map((item) => `${item.qty} x ${item.price}`).join(" + ");
    t.check(
      subtotal,
      satisfies((store: number) => store === byUnits || (addOns && store === byLines), `the line's price times its quantity is the store's subtotal (${worked} = ${money(byUnits)}; the subtotal is ${money(subtotal)}, from ${fromSummary !== null ? "the store's own order summary" : "the cart"})`),
    ).label("cart-line-times-quantity-is-subtotal");
  }
  // The total adds up from its parts when Agentcard names them. A total the store has not priced yet must say it is an estimate.
  if (raw && raw.subtotalCents !== null && raw.serviceFeesCents !== null) {
    const discounts = (raw.discounts ?? []).reduce((sum, discount) => sum + (discount.amountCents ?? discount.amount_cents ?? 0), 0);
    const parts = raw.subtotalCents + raw.serviceFeesCents + (raw.tipCents ?? 0);
    t.check(raw.totalCents, satisfies((total: number) => total === parts || total === parts + discounts || total === parts - Math.abs(discounts), `the total is the items plus the fees (items ${raw.subtotalCents}, fees ${raw.serviceFeesCents}, tip ${raw.tipCents ?? 0}, discounts ${discounts}, total ${raw.totalCents}, in cents)`)).label("cart-total-adds-up");
  } else if (raw) {
    const items = raw.items.reduce((sum, item) => sum + (item.lineTotalCents ?? 0), 0);
    t.check(raw.totalCents, satisfies((total: number) => total >= items, `the store's total is no less than its items (items ${items}, total ${raw.totalCents}, in cents)`)).label("cart-total-adds-up");
  }
  if (raw) t.check(cart.total_is_estimate, satisfies((estimate: boolean) => estimate === raw.totalIsEstimate, "the model is told whether the total is an estimate, as the app is")).label("cart-estimate-marked");
  // A booking with a date starts on a day asked for, as its line shows it. The first day a line names is the day the
  // booking starts; a later one can be the day it ends, or the last day it can be cancelled.
  if (row.window) {
    const start = daysIn(shows)[0];
    if (!start) t.log(`the booking's line names no day, so its day could not be checked against ${row.window.words}: ${short(shows, 160)}`);
    else t.check(start, satisfies((day: string) => inWindow(day, row.window!), `the booking is for the days asked for, ${row.window.words} (its line says it starts ${start}: ${short(shows, 120)})`)).label("booking-inside-the-dates");
  }
}

/** No turn of the chat placed or started an order, and none carries an order's id. */
export function checkNothingOrdered(t: EveEvalContext, purchase: Purchase): void {
  const ordered = purchase.steps.filter((step) => ["placing", "order_placed"].includes(step.answer?.status ?? "") || ["placing", "order_placed"].includes(step.snapshot?.status ?? "") || Boolean(step.snapshot?.order_id));
  t.check(ordered, satisfies((steps: Step[]) => steps.length === 0, `no order was placed or started (${ordered.map((step) => `after "${short(step.said, 40)}": ${step.snapshot?.status}, order ${step.snapshot?.order_id}`).join("; ") || "none was"})`)).label("nothing-ordered");
}

/**
 * The total the shopper is asked to say yes to is the one the chat last showed them, or the reply that changed it
 * names the new one. Compares each cart of the chat with the one before it.
 */
export function checkTotalNeverMovesSilently(t: EveEvalContext, purchase: Purchase): void {
  const silent: string[] = [];
  let before: string | null = null;
  for (const step of purchase.steps) {
    const total = step.answer?.cart?.total ?? null;
    if (!total) continue;
    const amount = dollars(total)?.toFixed(2);
    if (before !== null && total !== before && amount && !`${step.answer!.reply} ${step.turn.reply ?? ""}`.replace(/,/g, "").includes(amount)) silent.push(`${before} became ${total} after "${short(step.said, 40)}", and the reply did not name ${total}`);
    before = total;
  }
  t.check(silent, satisfies((moves: string[]) => moves.length === 0, `the total never changes without the reply saying so (${silent.join("; ") || "it never did"})`)).label("total-never-moves-silently");
}

/**
 * Each amount a reply presents as a price, total, estimate or charge of the cart it shows that the cart's fields
 * contradict, one line per reply. A model reads each reply against the cart (lib/reply-reader.ts), so a true amount the
 * cart holds in another form is never flagged: shipping and tax named apart, the gap between the card's price and the
 * store's, a deposit, the most the card is held for. A wrong estimate still is: on 2026-11-27 a reply said "about $24.84"
 * over a Best Buy cart of $21.29.
 */
export function wrongAmounts(purchase: Pick<Purchase, "steps">): string[] {
  return purchase.steps
    .filter((step) => Boolean(step.answer?.cart?.items.length) && (step.reading?.wrongAmounts.length ?? 0) > 0)
    .map((step) => `after "${short(step.said, 40)}" the reply quotes ${step.reading!.wrongAmounts.map((one) => `${one.amount} (${one.why})`).join("; ")}; the cart's total is ${step.answer!.cart!.total}`);
}

/**
 * The checks every purchase chat gets, whatever it was for, and the record of how it ended (lib/outcome.ts). Call it
 * once, after the last message of the chat.
 */
export function checkChat(t: EveEvalContext, row: StoreCase, purchase: Purchase): void {
  checkNothingOrdered(t, purchase);
  const steps = purchase.steps.filter((step) => step.answer !== null);

  // The example chat app passes every message to the buy tool. When it answers one itself, that is the app's mistake
  // and is counted apart from Agentcard's failures.
  t.check(
    purchase.appMistakes,
    satisfies((mistakes: Purchase["appMistakes"]) => mistakes.length === 0, `the example chat app passes every message of the shopper to the buy tool (${purchase.appMistakes.length === 0 ? "it did" : `it answered ${purchase.appMistakes.length} itself: ${purchase.appMistakes.map((one) => `after "${one.said}" it said: ${one.reply}`).join("; ")}`})`),
  ).label("app-called-the-buy-tool");
  if (purchase.broke) t.check(purchase.broke, satisfies(() => false, `the chat stays connected, with one retry (${purchase.broke})`)).label("chat-stayed-connected");

  // No approval or payment step before a cart: the shopper sees what they are buying, and what it costs, first.
  const firstCart = steps.findIndex((step) => Boolean(step.answer!.cart?.items.length));
  const early = steps.find((step, index) => {
    const answer = step.answer!;
    const links = answer.links_sent ?? [];
    const payment = ["approval_sent", "needs_card"].includes(answer.status) || links.includes("approval") || links.includes("vault") || ["approve", "add_card"].includes(answer.next_action ?? "");
    return payment && (firstCart < 0 || index < firstCart);
  });
  t.check(
    early ? short(early.said, 60) : null,
    satisfies((said: string | null) => said === null, `no approval or payment step comes before a cart${early ? ` (after "${short(early.said, 60)}", with no cart shown yet, Agentcard said: ${short(early.answer!.reply)})` : ""}`),
  ).label("cart-before-approval");

  // Questions are judged by the product and by what the shopper said (lib/questions.ts).
  t.check(purchase.unfair, satisfies((unfair: string[]) => unfair.length === 0, `every question is about a choice the product has and the shopper has not made yet (${purchase.unfair.join("; ") || "each one was"})`)).label("questions-are-fair");

  // Every answer says something to the shopper. An empty one leaves them waiting with nothing on the screen.
  const empty = steps.filter((step) => step.answer!.reply.trim() === "" && (step.turn.reply ?? "").trim() !== "" && !step.answer!.cart);
  const silent = steps.filter((step) => step.answer!.reply.trim() === "" && !step.answer!.cart);
  t.check(silent.length, satisfies((count: number) => count === 0, `Agentcard's answer is never empty (${silent.length === 0 ? "none was" : `${silent.length} ${silent.length === 1 ? "was" : "were"}: after ${silent.map((step) => `"${short(step.said, 50)}"${step.snapshot?.error_code ? ` (${step.snapshot.error_code})` : ""}`).join(", ")}${empty.length ? "; the chat app wrote its own words in their place" : ""}`})`)).label("never-an-empty-reply");

  // When a reply asks for the yes, in any words (its reading, lib/reply-reader.ts), the fields an app reads say the same,
  // and the reply names the amount the yes is for.
  const mismatched: string[] = [];
  const misquoted: string[] = [];
  for (const step of steps) {
    const answer = step.answer!;
    if (!answer.cart || answer.status !== "needs_input" || step.reading?.asks !== "pay_or_book") continue;
    const missing = answer.cart.details_needed ?? [];
    if (answer.next_action !== "confirm" || missing.length > 0) mismatched.push(`after "${short(step.said, 40)}" the reply asks for a yes, but the next step is ${answer.next_action ?? "none"}${missing.length ? ` and ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} still listed as missing` : ""}`);
    // The shopper says yes to an amount they were told. A reply that asks for the yes without naming the amount it is for
    // leaves them to find it elsewhere. A booking that costs nothing has no total to quote. A wrong amount is the next
    // check's (cart-reply-amounts-are-the-carts), so it is not counted twice.
    if (!step.reading.quotesTheCharge && (cents(answer.cart.total) ?? 0) > 0) misquoted.push(`after "${short(step.said, 40)}" the reply asks for a yes and does not name the amount it is for; the cart's total is ${answer.cart.total}`);
  }
  t.check(mismatched, satisfies((list: string[]) => list.length === 0, `when a reply asks for a yes, the answer's next step is the confirm and no detail is still listed as missing (${mismatched.join("; ") || "it always was"})`)).label("fields-agree-with-reply");
  t.check(misquoted, satisfies((list: string[]) => list.length === 0, `when a reply asks for a yes, it names the amount the yes is for (${misquoted.join("; ") || "it always did"})`)).label("reply-total-is-the-carts");

  // Every reply that shows a cart, not only the one that asks for the yes, quotes no amount the cart contradicts.
  const wrong = wrongAmounts(purchase);
  t.check(wrong, satisfies((list: string[]) => list.length === 0, `no reply that shows a cart quotes an amount the cart's fields contradict (${wrong.join("; ") || "none did"})`)).label("cart-reply-amounts-are-the-carts");

  // A detail asked for again after the shopper gave it was not taken: the reply names it, and says why. A reply that
  // only asks again leaves the shopper guessing what was wrong with the first one.
  t.check(purchase.reasked.length, satisfies((count: number) => count === 0, `a detail the shopper gave and Agentcard asks for again is named in the reply, with the reason it was not taken (${purchase.reasked.join("; ") || "none was asked for again without one"})`)).label("refused-detail-is-named");

  // A booking with a date: every card is for the days asked, and every card can be booked.
  if (row.window && purchase.cards.length > 0) {
    const window = row.window;
    const read = purchase.cards.map((card) => ({ card, ...cardDays({ field: card.date, page: card.url, name: card.name }) }));
    const outside = read.filter((one) => one.days.some((day) => !inWindow(day, window)));
    const dated = read.filter((one) => one.days.length > 0).length;
    t.check(
      outside.length,
      satisfies((count: number) => count === 0, `every card is for the days asked for, ${window.words} (${dated} of ${read.length} cards name a day${outside.length ? `; outside them: ${outside.map((one) => `"${short(one.card.name, 50)}" is for ${one.days.filter((day) => !inWindow(day, window)).join(", ")}, read from ${one.readFrom}`).join("; ")}` : ""})`),
    ).label("cards-inside-the-dates");
  }
  // Only what can be booked becomes a card. Something with no seats or no room is said in the reply and never offered
  // as a card: a card that says it has no room, or a card of the thing asked for with no price to book it at (a table
  // is free, so its cards show none).
  if (row.kind === "booking" && purchase.cards.length > 0) {
    const cannot = purchase.cards.filter((card) => card.availability === "unavailable" || (row.product.test(card.name) && row.free !== true && dollars(card.price) === null));
    t.check(
      cannot.length,
      satisfies((count: number) => count === 0, `nothing that cannot be booked, with no room or no price, is offered as a card (${cannot.length === 0 ? "nothing was" : `${cannot.length} of ${purchase.cards.length} cards were: ${cannot.slice(0, 6).map((card) => `"${short(card.name, 50)}" (${card.availability === "unavailable" ? "says it has no room" : "no price to book it at"})`).join("; ")}`})`),
    ).label("cards-can-be-booked");
  }

  // A store that needs the shopper's own account, asked for before any cart. Agentcard signs in with the shopper's own
  // account at that store, which the shopper gives once on Agentcard's own page. The sign-in comes first: a sign-in asked
  // for after other questions made the shopper answer them for nothing.
  // Where this run's shopper has a test account saved at the store (lib/store-accounts.ts), Agentcard signs in with it by
  // itself and asks for nothing, so a sign-in asked for is a failure. Where it has none, the sign-in is the store's own
  // answer: "no test account at this store".
  if (purchase.signIn) {
    const signIn = purchase.signIn;
    // Questions about the product's own options (its size, its colour) may come first: Agentcard asks those before the
    // sign-in on purpose, so the store's checkout carries on with them once the shopper is signed in.
    t.check(signIn.questionsBefore, satisfies((count: number) => count === 0, `a store that needs an account asks for the sign-in before anything but the product's own options (the shopper had already answered ${signIn.questionsBefore} other question${signIn.questionsBefore === 1 ? "" : "s"}${signIn.optionsBefore ? `, and ${signIn.optionsBefore} about the product's options,` : ""} when Agentcard said: ${signIn.said})`)).label("sign-in-offered-first");
    const saved = savedAccountAt(row.store);
    if (saved) t.check(signIn.said, satisfies(() => false, `Agentcard signs in with the shopper's saved account at ${row.store} without asking them to sign in (Agentcard said: ${signIn.said})`)).label("signs-in-with-saved-account");
    else if (signIn.questionsBefore === 0) purchase.storeAnswer = { what: "no test account at this store", read_from: "the answer's fields", said: signIn.said };
  }

  // A store account's password is typed on Agentcard's own page, never in the chat, where it would be kept as words.
  const password = steps.find((step) => asksPasswordInChat(step.answer!.reply));
  t.check(
    password ? short(password.answer!.reply, 200) : null,
    satisfies((asked: string | null) => asked === null, `no reply asks the shopper to type a password into the chat${password ? ` (after "${short(password.said, 40)}" Agentcard said: ${short(password.answer!.reply, 200)})` : ""}`),
  ).label("no-password-in-chat");

  // A store whose price is not the card's shows its own price, so the shopper sees it before any yes.
  if (purchase.storeAnswer?.what === "the store's price differs from the card's") {
    const last = steps.at(-1);
    const shown = amountsIn(last?.answer?.reply ?? "").filter((amount) => amount !== cents(purchase.picked?.price ?? null));
    t.check(shown, satisfies((amounts: number[]) => amounts.length > 0, `a store whose price is not the card's has its own price shown to the shopper (card: ${purchase.picked?.price ?? "none"}; Agentcard said: ${short(last?.answer?.reply ?? "", 240)})`)).label("store-price-shown");
  }

  const outcome: Outcome = {
    ...(purchase.storeAnswer ? { store_answer: purchase.storeAnswer } : {}),
    ...(purchase.appMistakes.length ? { app_mistakes: purchase.appMistakes } : {}),
    ...(purchase.broke ? { broke: purchase.broke } : {}),
  };
  if (purchase.storeAnswer) t.log(`the store's own answer: ${purchase.storeAnswer.what} (read from ${purchase.storeAnswer.read_from}). Agentcard said: ${purchase.storeAnswer.said}`);
  t.log(OUTCOME + JSON.stringify(outcome));
}
