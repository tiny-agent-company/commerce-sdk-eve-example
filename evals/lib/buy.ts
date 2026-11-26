import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { RECORD } from "./braintrust-reporter.js";
import { judge, type Verdict, type Want } from "./judge.js";

/** A product card as the shopper sees it in the chat. */
export interface Card {
  id: string | null;
  name: string;
  store: string | null;
  price: string | null;
}

/** The part of the buy tool's answer these evals read. */
export interface BuyAnswer {
  status: string;
  /** Agentcard's reply, as the model reads it. */
  reply: string;
  products: { product_id: string | null; name: string; store: string; price: string | null }[];
  cart: { store: string; items: { name: string; qty: number }[]; total: string } | null;
}

/** What one shopper message expects of the answer. */
export interface Expectation {
  /** What the shopper typed, with the earlier messages of the chat when they matter. */
  ask: string;
  /** Each thing the shopper asked for, and what must be true of a product for it to be that thing. */
  wants: Want[];
  /** The store the shopper named: every card must come from it. */
  store?: RegExp;
  /** The most a card may cost, in dollars. */
  maxPrice?: number;
  /** The least a card may cost, in dollars. */
  minPrice?: number;
  /** What a right answer looks like when it is not simply "show the thing": the reply's language, or that a store cannot be bought from. The judge reads it. */
  context?: string;
  /** False for things whose cards carry no price, such as a restaurant table or an event. */
  priced?: boolean;
  /** True when the thing asked for does not exist, so no card can be it: the cards are not graded, only the replies. */
  nothingToFind?: boolean;
  /** Kept for older cases. Every case now accepts a question back to the shopper with no cards. */
  mayAsk?: boolean;
}

/** Every call of the buy tool in a turn. */
export function buyCalls(turn: EveEvalTurn) {
  return turn.toolCalls.filter((call) => call.name === "buy");
}

/** The last answer the buy tool gave in a turn, or null when it gave none the eval can read. */
export function lastAnswer(turn: EveEvalTurn): BuyAnswer | null {
  const output = buyCalls(turn).at(-1)?.output;
  if (typeof output !== "string") return null;
  try {
    return JSON.parse(output) as BuyAnswer;
  } catch {
    return null;
  }
}

/**
 * Every product card the turn put in the chat, in the order it arrived, each once. The cards are read from what the
 * tool streamed to the chat, which is what the shopper sees. The list the model reads (`products`) can hold only the
 * last of several searches, so it is used only to fill in a card the stream did not carry.
 */
export function cardsShown(turn: EveEvalTurn): Card[] {
  const cards = new Map<string, Card>();
  const add = (card: Card) => {
    const key = card.id ?? `${card.name}|${card.store}`;
    // A card sent again in the same turn carries its newest price, so the last copy wins and the first keeps its place.
    cards.set(key, card);
  };
  for (const event of turn.events) {
    if (event.type !== "call.progress") continue;
    const output = (event.data as { output?: unknown }).output;
    if (!output || typeof output !== "object") continue;
    for (const link of (output as { links?: Record<string, unknown>[] }).links ?? []) {
      if (link.kind !== "product" || typeof link.title !== "string") continue;
      add({ id: (link.productId as string) ?? null, name: link.title, store: (link.store as string) ?? null, price: (link.price as string) ?? null });
    }
  }
  // The model's list fills in only a product no card carried: its price is the one the reply quotes.
  for (const product of lastAnswer(turn)?.products ?? []) {
    if (!cards.has(product.product_id ?? `${product.name}|${product.store}`)) add({ id: product.product_id, name: product.name, store: product.store, price: product.price });
  }
  return [...cards.values()];
}

/** The products a turn's searches found past the cards they showed, which the replies may still mention. */
export function cardsNotShown(turn: EveEvalTurn): Card[] {
  let more: Card[] = [];
  for (const event of turn.events) {
    if (event.type !== "call.progress") continue;
    const output = (event.data as { output?: unknown }).output;
    if (!output || typeof output !== "object") continue;
    const links = (output as { more?: Record<string, unknown>[] }).more ?? [];
    if (links.length > 0) more = links.map((link) => ({ id: (link.productId as string) ?? null, name: String(link.title ?? ""), store: (link.store as string) ?? null, price: (link.price as string) ?? null }));
  }
  return more;
}

/** A price such as `$12.99` or `from $1,069.00` in dollars, or null when there is none. */
export function dollars(price: string | null): number | null {
  const found = price?.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return found ? Number(found[0]) : null;
}

const line = (card: Card) => `${card.name.slice(0, 90)} (${card.store ?? "no store"}, ${card.price ?? "no price"})`;

/**
 * The words the turn's first buy call sent to Agentcard. The tool sends the shopper's message from the chat, whatever the
 * model put in `ask` (agent/lib/shopper-words.ts), and names the words it sent in each snapshot it streams; a turn with no
 * snapshot falls back to the model's `ask`.
 */
export function wordsSent(turn: EveEvalTurn): string | undefined {
  for (const event of turn.events) {
    if (event.type !== "call.progress") continue;
    const output = (event.data as { output?: unknown }).output;
    if (output && typeof output === "object" && typeof (output as { ask?: unknown }).ask === "string") return (output as { ask: string }).ask;
  }
  const ask = buyCalls(turn)[0]?.input.ask;
  return ask === undefined ? undefined : String(ask);
}

/**
 * The agent hands the buy tool the shopper's message as it was typed. A reworded ask tests the agent's wording, not the
 * shopper's, and can hide or cause a wrong answer. `showWords` is false for a real shopper's ask, whose words stay out
 * of the check's message.
 */
export function checkWordsUnchanged(t: EveEvalContext, turn: EveEvalTurn, message: string, showWords = true): void {
  const plain = (text: unknown) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sent = wordsSent(turn);
  if (sent === undefined) return;
  t.check(sent, satisfies((ask: unknown) => plain(ask) === plain(message), `the buy tool got the shopper's words unchanged${showWords ? ` (it got: ${String(sent)})` : ""}`)).label("shopper-words-unchanged");
}

/**
 * The checks every turn must pass, whatever the shopper asked: nothing failed, no order was placed or started, and the
 * agent's reply has no link in it. `shopperSaidYes` is for the one kind of turn where the shopper did say yes (the
 * checkout evals): the call may then confirm and Agentcard may stop it at the payment, but still nothing may be ordered.
 */
export function checkTurn(t: EveEvalContext, turn: EveEvalTurn, shopperSaidYes = false): void {
  turn.noFailedCalls();
  // A turn where the shopper said yes may confirm, and may be stopped at the payment: the checkout evals grade that stop.
  if (!shopperSaidYes) {
    t.check(
      buyCalls(turn),
      satisfies((calls: ReturnType<typeof buyCalls>) => calls.every((call) => call.input.confirm === false), "no call confirms an order"),
    ).label("no-order-without-yes");
  }
  const reply = turn.reply ?? "";
  t.check(reply, satisfies((text: string) => text.trim().length > 0, "the agent replies")).label("agent-replies");
  t.check(reply, satisfies((text: string) => !/https?:\/\/|www\./i.test(text), "the agent's reply has no link")).label("no-link-in-reply");
  const answer = lastAnswer(turn);
  if (!answer) return;
  if (!shopperSaidYes) {
    t.check(
      answer.status,
      satisfies((status: string) => status !== "declined", `Agentcard did not refuse (it said: ${answer.reply.slice(0, 200)})`),
    ).label("not-declined");
  }
  t.check(
    answer.status,
    satisfies((status: string) => !(shopperSaidYes ? ["placing", "order_placed"] : ["placing", "order_placed", "approval_sent"]).includes(status), "no order was started"),
  ).label("no-order-started");
}

/**
 * Grades one answer against what the shopper asked for.
 *
 * Fixed rules cover what a rule can know exactly: the cards are complete and each sits inside the budget. Cards from
 * a store other than the one the shopper named pass only when the reply says first that the named store missed. A judge model then reads every card against every requirement of the ask, and
 * both replies against the cards (judge.ts), and the eval fails when:
 * - fewer than 80% of the cards are what was asked for (`accurate-cards`),
 * - one of the first three cards is not (`top-cards-accurate`),
 * - something the shopper asked for has no card that is it (`every-item-covered`),
 * - a product a reply recommends is not what was asked for (`recommended-fits`),
 * - Agentcard's reply says something the cards contradict (`agentcard-reply-true`),
 * - the chat agent's own reply does (`agent-reply-true`),
 * - the replies do not respond to what was asked (`answers-the-ask`).
 *
 * `earlier` holds the cards of the chat's earlier turns: a follow-up the agent answers from cards already in the chat
 * is graded on those.
 */
export async function checkAnswer(t: EveEvalContext, turn: EveEvalTurn, expected: Expectation, earlier: Card[] = []): Promise<Card[]> {
  checkTurn(t, turn);
  const answer = lastAnswer(turn);
  const fresh = cardsShown(turn);
  const cards = fresh.length > 0 ? fresh : earlier;
  const replies = { agentcard: answer?.reply ?? "", agent: turn.reply ?? "" };
  t.log(`${fresh.length} new cards${fresh.length === 0 && earlier.length > 0 ? ` (answered from ${earlier.length} earlier ones)` : ""}`);
  cards.forEach((card, index) => t.log(`card ${index + 1}: ${line(card)}`));
  t.log(`Agentcard's reply: ${replies.agentcard}`);
  t.log(`The agent's reply: ${replies.agent}`);
  // One line the Braintrust reporter reads back, so a row shows what the shopper saw on this turn.
  t.log(RECORD + JSON.stringify({ shopper: expected.ask, cards: cards.map((card) => ({ name: card.name, store: card.store, price: card.price })), answered_from_earlier_cards: fresh.length === 0 && earlier.length > 0, agentcard_reply: replies.agentcard, agent_reply: replies.agent, wants: expected.wants, context: expected.context }));

  // A clarifying question is never a failure: an answer that shows nothing and asks the shopper something passes.
  const asked = /\?/.test(replies.agent) || /\?/.test(replies.agentcard);
  t.check(cards, satisfies((list: Card[]) => list.length > 0 || asked || expected.mayAsk === true, "the shopper is shown at least one product, or asked a question")).label("has-cards");
  if (cards.length > 0) {
    const missing = cards.filter((card) => !card.name || !card.store || (expected.priced !== false && dollars(card.price) === null));
    t.check(missing, satisfies((list: Card[]) => list.length === 0, `every card has a name, a store and a price (missing on: ${missing.map(line).join("; ")})`)).label("complete-cards");
    if (expected.maxPrice !== undefined || expected.minPrice !== undefined) {
      const [floor, most] = [expected.minPrice ?? 0, expected.maxPrice ?? Infinity];
      const outside = cards.filter((card) => {
        const price = dollars(card.price);
        return price !== null && (price < floor || price > most);
      });
      t.check(outside, satisfies((list: Card[]) => list.length === 0, `every card is inside the budget (outside: ${outside.map(line).join("; ")})`)).label("within-budget");
    }
  }

  const verdict = judge(expected, cards, replies, cardsNotShown(turn));
  if (cards.length > 0 && expected.store) {
    // Cards from another store are a right answer only when the reply says first that the named store had nothing,
    // could not be searched or cannot be shopped at. Shown without that, they pass for the named store's.
    const others = cards.filter((card) => !expected.store!.test(card.store ?? ""));
    t.score(verdict.then((v) => ({ score: others.length === 0 || v.saysNamedStoreMissed ? 1 : 0, message: others.length === 0 ? "every card comes from the store the shopper named" : `${v.saysNamedStoreMissed ? "the reply says first that the named store missed; " : "the reply does not say the named store missed; "}cards from other stores: ${others.map(line).join("; ")}` })))
      .label("named-store")
      .gate(1);
  }
  const wrong = (v: Verdict) => v.cards.filter((card) => !card.accurate).map((card) => `card ${card.index + 1} ${cards[card.index]?.name.slice(0, 60)}: ${card.unmet.join(", ") || "not something that was asked for"}`);
  if (cards.length > 0 && !expected.nothingToFind) {
    t.score(verdict.then((v) => ({ score: v.cards.filter((card) => card.accurate).length / cards.length, message: wrong(v).join("; ") || "every card is what was asked for" })))
      .label("accurate-cards")
      .gate(0.8);
    t.score(verdict.then((v) => ({ score: v.cards.slice(0, 3).every((card) => card.accurate) ? 1 : 0, message: wrong({ ...v, cards: v.cards.slice(0, 3) }).join("; ") || "the first three cards are what was asked for" })))
      .label("top-cards-accurate")
      .gate(1);
    t.score(verdict.then((v) => ({ score: v.uncovered.length === 0 ? 1 : 0, message: v.uncovered.length ? `no card is: ${v.uncovered.join(", ")}` : "every item asked for has a card" })))
      .label("every-item-covered")
      .gate(1);
    t.score(verdict.then((v) => ({ score: v.badRecommendations.length === 0 ? 1 : 0, message: v.badRecommendations.join("; ") || "every recommended product is what was asked for" })))
      .label("recommended-fits")
      .gate(1);
  }
  t.score(verdict.then((v) => ({ score: v.agentcardFalseClaims.length === 0 ? 1 : 0, message: v.agentcardFalseClaims.join("; ") || "nothing in Agentcard's reply contradicts the cards" })))
    .label("agentcard-reply-true")
    .gate(1);
  t.score(verdict.then((v) => ({ score: v.agentFalseClaims.length === 0 ? 1 : 0, message: v.agentFalseClaims.join("; ") || "nothing in the agent's reply contradicts the cards" })))
    .label("agent-reply-true")
    .gate(1);
  t.score(verdict.then((v) => ({ score: v.answersTheAsk || (asked && cards.length === 0) ? 1 : 0, message: asked && cards.length === 0 ? "the reply asks the shopper a question, which is never a failure" : v.answerNote })))
    .label("answers-the-ask")
    .gate(1);
  return cards;
}
