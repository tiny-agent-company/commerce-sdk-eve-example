import { AgentcardClient } from "@agent-cards/commerce-sdk";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { RECORD } from "./braintrust-reporter.js";
import { buyCalls, cardsShown, checkTurn, dollars, lastAnswer, type Card } from "./buy.js";
import { SUPPLIERS, type StoreCase } from "./stores.js";

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

/** The host of the product catalog supplier's links. A card whose page is there came from the catalog. */
const CATALOG_HOST = /(^|\.)trychannel3\.com$/i;

/** One cart as the model reads it: the part these evals check. */
interface Cart {
  store: string;
  items: { product_id: string | null; other_product_ids?: string[]; name: string; qty: number; price: string | null; line_total: string | null }[];
  fees: string | null;
  total: string;
  total_is_estimate: boolean;
  total_status?: string;
  details_needed?: string[];
}

/** The buy tool's answer as the model reads it. */
interface Answer {
  status: string;
  next_action: string | null;
  reply: string;
  cart: Cart | null;
  links_sent?: string[];
  choice?: { question: string | null; groups: { name: string; required: boolean; options: string[] }[] };
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
  links: { kind: string; url?: string | null; productId?: string }[];
}

/** One message of the chat and what came back. */
export interface Step {
  said: string;
  turn: EveEvalTurn;
  answer: Answer | null;
  snapshot: Snapshot | null;
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

/** Whether each card of a turn opens the catalog's link or a page on the store's own site, by the card's id. */
function cardPages(turn: EveEvalTurn): Map<string, "catalog" | "store page"> {
  const pages = new Map<string, "catalog" | "store page">();
  for (const link of snapshotOf(turn)?.links ?? []) {
    if (link.kind !== "product" || !link.productId || !link.url) continue;
    try {
      pages.set(link.productId, CATALOG_HOST.test(new URL(link.url).host) ? "catalog" : "store page");
    } catch {
      // A card whose link cannot be read belongs to neither.
    }
  }
  return pages;
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

const short = (text: string, most = 220) => text.replace(/\s+/g, " ").trim().slice(0, most);

/**
 * The details a reply asks the shopper for, as one message. The first time, everything the reply names goes in one
 * message. After that only what the reply still needs: "Thanks, I have your phone. I still need your name." gets the name.
 */
function detailsAskedFor(reply: string, sent: Set<string>): string | null {
  const fields = (text: string) => {
    const parts: string[] = [];
    if (/\bname\b/i.test(text)) parts.push(SHOPPER.name);
    if (/date of birth|birth ?date|\bdob\b/i.test(text)) parts.push(SHOPPER.bornOn);
    if (/\bgender\b/i.test(text)) parts.push(SHOPPER.gender);
    if (/e-?mail/i.test(text)) parts.push(SHOPPER.email);
    if (/phone|mobile number/i.test(text)) parts.push(SHOPPER.phone);
    return parts.join(", ");
  };
  const all = fields(reply);
  if (all && !sent.has(all)) return all;
  const stillNeeded = fields(reply.split(/(?<=[.?!])\s+|\n+/).filter((line) => !/\b(i have|i've got|is saved|are saved|already|came through|i got|got your)\b/i.test(line)).join(" "));
  return stillNeeded || all || null;
}

/** True when the answer shows the final cart and asks for the yes that pays or books it. */
export function readyForTheYes(answer: Answer | null): boolean {
  if (!answer?.cart || answer.status !== "needs_input") return false;
  if (answer.next_action === "confirm") return true;
  return /say yes to (place|book|order|confirm|pay)|say yes and i'll (place|book|order)|confirm to pay|should i book it\?/i.test(answer.reply);
}

/** What the shopper says next, or null when the reply asks for nothing this shopper can give. */
function nextMessage(answer: Answer, row: StoreCase, sent: Set<string>, options: string[] = []): string | null {
  const reply = answer.reply;
  const firstValue = (value: string | undefined) => value?.replace(/\s*\(\+[^)]*\)\s*$/, "").trim();
  // A required choice, such as a size or a taco's filling: the first value of each group, as the store lists it.
  if (answer.choice?.groups.length) {
    const groups = answer.choice.groups.filter((group) => group.required);
    const message = (groups.length > 0 ? groups : answer.choice.groups.slice(0, 1)).map((group) => firstValue(group.options[0])).filter(Boolean).join(", ");
    if (message && !sent.has(message)) return message;
  }
  // The address read back: "Is it 1 Ferry Plz, San Francisco, CA 94111? Say yes, or send me the right address."
  if (/say yes,? or (send|tell|give)/i.test(reply) || /^is (it|that) .+\?/i.test(reply.trim())) return row.kind === "booking" ? null : "yes";
  if (/date of birth|\bgender\b|\be-?mail\b|full name|legal (first|name)|first and last name|what name|driver's details|guest details/i.test(reply)) return detailsAskedFor(reply, sent);
  if (/phone/i.test(reply) && /\?|need/i.test(reply)) return SHOPPER.phone;
  if (answer.next_action === "shipping_details" || /(where|what|which|send|need).{0,60}(address|deliver|ship|zip)/i.test(reply)) return sent.has(SHOPPER.address) ? null : SHOPPER.address;
  if (/as it comes|the standard way|or changed\?/i.test(reply)) return "as it comes";
  // A choice written on one line: "Which size? Size: XS, S, M, L". The shopper is a medium, else takes the first.
  const inline = reply.match(/\?\s*[A-Za-z ]{2,20}:\s*([^.\n]+,[^.\n]+)/);
  if (inline) {
    const values = inline[1]!.split(/,\s*/).map((value) => value.trim()).filter(Boolean);
    const value = values.find((one) => /^(m|medium)$/i.test(one)) ?? values.find((one) => !sent.has(one));
    if (value && !sent.has(value)) return value;
  }
  // "Want me to add it to your cart?", or the same product at the price the store now shows: yes, while no cart exists.
  // This is never the yes that pays, which is only asked for over a cart.
  if (!answer.cart && row.kind !== "booking" && /(want me to|should i|shall i) (add|get|put)|do you want (it|the|this|that|one)\b[^?]*\?|want (it|this one|that one)\?/i.test(reply) && !/which (one|size|colou?r)/i.test(reply)) return "yes";
  // Two products told apart by number: the first.
  if (!answer.cart && /^\s*1[.)]\s+/m.test(reply) && /which (one|of)/i.test(reply) && !sent.has("number 1")) return "number 1";
  // A choice written out as a list under a question, such as a colour: the first value listed that was not tried yet, so
  // a value the store then says is sold out is followed by the next one.
  const listed = [...reply.matchAll(/^\s*[•\-*]\s*(.+)$/gm)].map((found) => firstValue(found[1])).filter((value): value is string => Boolean(value));
  if (listed.length > 1 && /\?/.test(reply)) options.splice(0, options.length, ...listed);
  if (/\?/.test(reply) && (listed.length > 1 || /sold out|out of stock|unavailable|isn't available/i.test(reply))) return options.find((value) => !sent.has(value)) ?? null;
  return null;
}

/**
 * Plays the shopper for one row: asks, picks a card, then answers the checkout's questions until `goal` is reached.
 * `cart` stops as soon as the product is in a cart. `checkout` goes on until Agentcard shows the final cart and asks
 * for the yes. It never says yes to a cart itself; the checkout eval does that, for goods only.
 *
 * A store that is down, a call that fails or a checkout that asks for something no eval can give ends the chat with
 * the reason in `stopped`, which the eval reports as that store's failure.
 */
export async function shop(t: EveEvalContext, row: StoreCase, goal: "cart" | "checkout", budgetMs = 480_000): Promise<Purchase> {
  const started = Date.now();
  const purchase: Purchase = { steps: [], picked: null, stopped: null, handed: null };
  const sent = new Set<string>();
  // The values of the last choice the store listed, such as its colours.
  const options: string[] = [];
  let session: EveEvalTurn["session"] | undefined;

  const say = async (message: string, afterThePick = false): Promise<Step | null> => {
    sent.add(message);
    let turn: EveEvalTurn;
    try {
      turn = session ? await session.send(message) : await t.send(message);
    } catch (error) {
      purchase.stopped = `the chat broke after the shopper said "${short(message, 80)}": ${short(error instanceof Error ? error.message : String(error))}`;
      return null;
    }
    session = turn.session;
    const step: Step = { said: message, turn, answer: lastAnswer(turn) as Answer | null, snapshot: snapshotOf(turn) };
    purchase.steps.push(step);
    // The ask and the pick must not confirm or be refused. A later turn may answer "yes" to an address read back, and a
    // refusal there is reported once, as the reason the chat stopped.
    checkTurn(t, turn, afterThePick);
    const cart = step.answer?.cart;
    t.log(`shopper: ${short(message, 120)}`);
    t.log(`  Agentcard (${step.answer?.status ?? "no answer"}, next: ${step.answer?.next_action ?? "none"}${step.snapshot?.decline_code ? `, stopped: ${step.snapshot.decline_code}` : ""}): ${short(step.answer?.reply ?? turn.reply ?? "")}`);
    if (cart) t.log(`  cart at ${cart.store}: ${cart.items.map((item) => `${item.qty} x ${short(item.name, 60)} (${item.price ?? "no price"})`).join("; ")}; total ${cart.total}${cart.total_is_estimate ? " (estimate)" : ""}; checked out through ${checkoutPath(step.snapshot?.carts.at(-1)?.merchant)}`);
    t.log(RECORD + JSON.stringify({ shopper: message, cards: purchase.steps.length === 1 ? cardsShown(turn).map((card) => ({ name: card.name, store: card.store, price: card.price })) : [], agentcard_reply: step.answer?.reply ?? "", agent_reply: turn.reply ?? "", cart: cart ?? null, wants: [] }));
    const failed = buyCalls(turn).find((call) => call.status !== "completed");
    if (failed) purchase.stopped = `the buy tool's call ${failed.status}: ${short(typeof failed.output === "string" ? failed.output : JSON.stringify(failed.output ?? ""))}`;
    else if (!step.answer) purchase.stopped = `the agent answered without the buy tool: ${short(turn.reply ?? "")}`;
    return purchase.stopped ? null : step;
  };

  const reached = (answer: Answer | null) => (goal === "cart" ? Boolean(answer?.cart?.items.length) : readyForTheYes(answer));

  let step = await say(row.ask);
  if (!step) return purchase;

  // Pick a card, unless an answer already put the product in a cart. A question that comes before any card is answered
  // first: the delivery address for food, or "want me to add it to your cart?" when the reply names the product and
  // shows no card for it.
  for (let asked = 0; asked < 4 && !step.answer?.cart && !purchase.picked; asked++) {
    const pages = cardPages(step.turn);
    const cards = cardsShown(step.turn);
    const fits = (card: Card) => row.product.test(card.name) && (row.maxPrice === undefined || (dollars(card.price) ?? 0) <= row.maxPrice) && (!row.at || !card.store || row.at.test(card.store));
    const fromSupplier = (card: Card) => card.id !== null && pages.get(card.id) === row.cards;
    // A row that names a supplier's cards takes only those. Any other row takes the first card that is the product,
    // one that opens the store's own page before one from the catalog.
    const pick = row.cards ? cards.find((card) => fits(card) && fromSupplier(card)) : (cards.find((card) => fits(card) && card.id !== null && pages.get(card.id) === "store page") ?? cards.find(fits));
    if (pick) {
      purchase.picked = pick;
      break;
    }
    const seen = cards.map((card) => `${short(card.name, 50)} (${card.store ?? "no store"}, ${card.price ?? "no price"}, ${card.id ? (pages.get(card.id) ?? "no page") : "no id"})`);
    const question = !row.cards && step.answer ? nextMessage(step.answer, row, sent, options) : null;
    if (!question) {
      purchase.stopped = row.cards
        ? `no card for the asked product came from the ${SUPPLIERS[row.supplier]} (${row.cards === "catalog" ? "a card that opens the catalog's link" : "a card that opens the store's own page"}). Cards shown: ${seen.join("; ") || "none"}. Agentcard said: ${short(step.answer?.reply ?? "")}`
        : `no card shown is the asked product at the asked store, under $${row.maxPrice ?? "any"}. Cards shown: ${seen.join("; ") || "none"}. Agentcard said: ${short(step.answer?.reply ?? "")}`;
      return purchase;
    }
    step = await say(question);
    if (!step) return purchase;
  }
  if (purchase.picked && !step.answer?.cart) {
    t.log(`picking: ${purchase.picked.name} (${purchase.picked.store}, ${purchase.picked.price})`);
    // The card's place in the list the model reads goes first, so two cards with one name and price are told apart.
    const place = ((lastAnswer(step.turn)?.products ?? []) as { product_id: string | null }[]).findIndex((product) => product.product_id === purchase.picked!.id) + 1;
    step = await say(`I want ${place > 0 ? `number ${place}` : "this one"}: ${purchase.picked.name}${purchase.picked.price ? `, ${purchase.picked.price}` : ""}`);
    if (!step) return purchase;
    const ids = buyCalls(step.turn).map((call) => call.input.product_id);
    t.check(ids, satisfies((list: unknown[]) => list.includes(purchase.picked!.id), `the agent passes the picked card's id to the buy tool (it passed: ${ids.join(", ") || "none"})`)).label("picks-the-shown-card");
  }

  // Answer what the checkout asks, a few messages at most.
  for (let asked = 0; asked < 9 && !reached(step.answer); asked++) {
    const answer = step.answer!;
    // A step the shopper takes outside the chat ends it here: no eval opens a payment page or signs in to a store.
    const links = answer.links_sent ?? [];
    if ((answer.status === "approval_sent" && links.includes("approval")) || (answer.status === "needs_card" && links.includes("vault"))) {
      purchase.handed = "payment";
      return purchase;
    }
    if (answer.next_action === "store_login" || links.includes("store_login")) {
      purchase.handed = "sign-in";
      if (!answer.cart) purchase.stopped = `the store asks the shopper to sign in to their own account before it builds a cart, and an eval has no account to sign in to. Agentcard said: ${short(answer.reply)}`;
      return purchase;
    }
    if (["declined", "needs_card", "approval_sent", "placing", "order_placed"].includes(answer.status)) {
      purchase.stopped = `Agentcard stopped with "${answer.status}"${step.snapshot?.decline_code ? ` (${step.snapshot.decline_code})` : ""} before ${goal === "cart" ? "a cart existed" : "the purchase was ready to pay"}: ${short(answer.reply)}`;
      return purchase;
    }
    if (Date.now() - started > budgetMs) {
      purchase.stopped = `out of time after ${Math.round((Date.now() - started) / 60_000)} minutes, still not ${goal === "cart" ? "in a cart" : "ready to pay"}. Agentcard last said: ${short(answer.reply)}`;
      return purchase;
    }
    const message = nextMessage(answer, row, sent, options);
    if (!message) {
      purchase.stopped = `the checkout asked for something this shopper cannot give, or said nothing to answer${step.snapshot?.error_code ? ` (${step.snapshot.error_code})` : ""}. Agentcard said: ${short(answer.reply, 300)}`;
      return purchase;
    }
    step = await say(message, true);
    if (!step) return purchase;
  }
  if (!reached(step.answer) && !purchase.handed) purchase.stopped = `still not ${goal === "cart" ? "in a cart" : "ready to pay"} after ${purchase.steps.length} messages. Agentcard last said: ${short(step.answer?.reply ?? "", 300)}`;
  return purchase;
}

/** True when the answer to a yes says the store has not sent its final total yet, so nothing can be paid for now. */
export function stillPricing(answer: Answer | null): boolean {
  return answer?.status === "needs_input" && /still (pricing|working out|hasn't)|hasn't sent (its|the) (final )?(total|price)|isn't final yet|no final total yet|waiting (for|on) .{0,40}(total|price)/i.test(answer.reply);
}

/** Says yes once more in the same chat, for the checkout eval. */
export async function sayYes(t: EveEvalContext, purchase: Purchase, words = "yes"): Promise<Step | null> {
  const last = purchase.steps.at(-1)!;
  let turn: EveEvalTurn;
  try {
    turn = await last.turn.session.send(words);
  } catch (error) {
    purchase.stopped = `the chat broke after the shopper said yes: ${short(error instanceof Error ? error.message : String(error))}`;
    return null;
  }
  const step: Step = { said: words, turn, answer: lastAnswer(turn) as Answer | null, snapshot: snapshotOf(turn) };
  purchase.steps.push(step);
  checkTurn(t, turn, true);
  t.log(`shopper: ${words}`);
  t.log(`  Agentcard (${step.answer?.status ?? "no answer"}, next: ${step.answer?.next_action ?? "none"}${step.snapshot?.decline_code ? `, stopped: ${step.snapshot.decline_code}` : ""}, links: ${(step.answer?.links_sent ?? []).join(", ") || "none"}): ${short(step.answer?.reply ?? turn.reply ?? "")}`);
  t.log(RECORD + JSON.stringify({ shopper: words, cards: [], agentcard_reply: step.answer?.reply ?? "", agent_reply: turn.reply ?? "", cart: step.answer?.cart ?? null, wants: [] }));
  if (!step.answer) purchase.stopped = `the agent answered the shopper's yes without the buy tool: ${short(turn.reply ?? "")}`;
  return purchase.stopped ? null : step;
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

/**
 * The cart holds exactly what the shopper picked, at the store they named, with a price and a total that adds up.
 * Every rule here is fixed: no model judges a cart.
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
  if (!row.free) {
    t.check(line.price, satisfies((price: string | null) => (dollars(price) ?? 0) > 0, `the cart's line shows a price (it shows ${line.price ?? "none"})`)).label("cart-line-priced");
    t.check(cart.total, satisfies((total: string) => (dollars(total) ?? 0) > 0, `the cart shows a total (it shows ${cart.total})`)).label("cart-has-total");
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
 * When the reply asks for the yes, the fields an app reads say the same: the next step is the confirm, and no guest
 * detail is still listed as missing. An app that draws its button from the fields would otherwise ask for details again.
 */
export function checkFieldsAgreeWithReply(t: EveEvalContext, step: Step): void {
  const answer = step.answer!;
  const missing = answer.cart?.details_needed ?? [];
  t.check(
    answer.next_action,
    satisfies((next: string | null) => (next === "confirm" || next === null) && missing.length === 0, `the reply asks for a yes, and the answer's fields agree (next step: ${answer.next_action ?? "none"}; details still listed as missing: ${missing.join(", ") || "none"})`),
  ).label("fields-agree-with-reply");
}
