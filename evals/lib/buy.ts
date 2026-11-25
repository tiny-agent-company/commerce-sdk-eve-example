import { generateText, Output } from "ai";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";

/** A product as the buy tool hands it to the model: no links, the price as the shopper reads it. */
export interface BuyProduct {
  product_id: string | null;
  name: string;
  store: string;
  price: string | null;
  link_sent: boolean;
}

/** The part of the buy tool's answer these evals grade. */
export interface BuyAnswer {
  status: string;
  reply: string;
  products: BuyProduct[];
  cart: { store: string; items: { name: string; qty: number }[]; total: string } | null;
  product_links_sent: number;
}

/** What one search case expects of the answer. */
export interface SearchExpectation {
  /** What the shopper types. */
  ask: string;
  /** Words that say a product is the kind the shopper asked for. */
  match?: RegExp;
  /** The store the shopper named: every product must come from it. */
  store?: RegExp;
  /** The most a product may cost, in dollars. */
  maxPrice?: number;
  /** The least a product may cost, in dollars. */
  minPrice?: number;
  /** The fewest products the answer must show. Defaults to 1; 0 for an ask the tool answers with a question. */
  minProducts?: number;
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

/** A price such as `$12.99` or `from $1,069.00` in dollars, or null when there is none. */
export function dollars(price: string | null): number | null {
  const found = price?.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return found ? Number(found[0]) : null;
}

/** The share of `items` that pass `test`, from 0 to 1; 1 for an empty list. */
function share<T>(items: readonly T[], test: (item: T) => boolean): number {
  return items.length === 0 ? 1 : items.filter(test).length / items.length;
}

/**
 * The checks every shopping turn must pass, whatever the shopper asked: the buy tool ran and did not fail, it placed
 * no order, and the agent's own reply is one short line with no link in it.
 */
export function checkTurn(t: EveEvalContext, turn: EveEvalTurn): BuyAnswer | null {
  turn.calledTool("buy");
  turn.noFailedCalls();
  t.check(
    buyCalls(turn),
    satisfies((calls: ReturnType<typeof buyCalls>) => calls.every((call) => call.input.confirm === false), "no call confirms an order"),
  ).label("no-order-without-yes");

  const reply = turn.reply ?? "";
  t.check(reply, satisfies((text: string) => text.trim().length > 0, "the agent replies")).label("agent-replies");
  t.check(reply, satisfies((text: string) => !/https?:\/\/|www\./i.test(text), "the agent's reply has no link")).label("no-link-in-reply");
  t.check(reply, satisfies((text: string) => text.length <= 400, "the agent's reply is short")).label("short-reply").soft(1);

  const answer = lastAnswer(turn);
  t.check(answer, satisfies((value: BuyAnswer | null) => value !== null, "the buy tool returned an answer")).label("buy-answered");
  if (!answer) return null;

  t.check(
    answer.status,
    satisfies((status: string) => status !== "declined", `Agentcard did not refuse (reply: ${answer.reply.slice(0, 200)})`),
  ).label("not-declined");
  t.check(
    answer.status,
    satisfies((status: string) => !["placing", "order_placed", "approval_sent"].includes(status), "no order was started"),
  ).label("no-order-started");
  return answer;
}

/** Grades the products a search turn showed against what the case expects. */
export function checkSearch(t: EveEvalContext, turn: EveEvalTurn, expected: SearchExpectation): BuyAnswer | null {
  const answer = checkTurn(t, turn);
  if (!answer) return null;
  const { products } = answer;
  const names = products.map((product) => `${product.name} (${product.store}, ${product.price ?? "no price"})`).join("; ");
  t.log(`status ${answer.status}, ${products.length} products: ${names}`);
  t.log(`Agentcard's reply: ${answer.reply}`);

  const least = expected.minProducts ?? 1;
  t.check(products, satisfies((list: BuyProduct[]) => list.length >= least, `shows at least ${least} product(s)`)).label("has-products");
  t.check(
    products,
    satisfies((list: BuyProduct[]) => list.every((product) => product.name && product.store && dollars(product.price) !== null), "every product has a name, a store and a price"),
  ).label("complete-cards");
  t.check(
    products,
    satisfies((list: BuyProduct[]) => list.every((product) => product.link_sent), "every product's card reached the chat"),
  ).label("cards-sent");
  t.check(
    products,
    satisfies((list: BuyProduct[]) => new Set(list.map((product) => product.product_id ?? product.name)).size === list.length, "no product is shown twice"),
  ).label("no-duplicates");

  if (expected.store) {
    const store = expected.store;
    t.check(
      products,
      satisfies((list: BuyProduct[]) => list.every((product) => store.test(product.store)), `every product comes from the store the shopper named (${names})`),
    ).label("named-store");
  }
  if (expected.maxPrice !== undefined) {
    const most = expected.maxPrice;
    t.check(
      products,
      satisfies((list: BuyProduct[]) => list.every((product) => (dollars(product.price) ?? 0) <= most), `no product costs more than $${most} (${names})`),
    ).label("within-budget");
  }
  if (expected.minPrice !== undefined) {
    const floor = expected.minPrice;
    t.check(
      products,
      satisfies((list: BuyProduct[]) => list.every((product) => (dollars(product.price) ?? floor) >= floor), `no product costs less than $${floor} (${names})`),
    ).label("above-floor");
  }
  if (expected.match && products.length > 0) {
    const match = expected.match;
    t.score({
      score: share(products, (product) => match.test(product.name)),
      message: `products that are the kind asked for: ${names}`,
    })
      .label("on-topic")
      .gate(0.6);
  }
  if (products.length > 0) {
    const grade = gradeProducts(expected.ask, answer);
    t.score(grade.then(({ fitting, reason }) => ({ score: fitting / products.length, message: `${fitting} of ${products.length} products fit: ${reason}` })))
      .label("fits-the-ask")
      .atLeast(0.7);
    t.score(grade.then(({ reply_true, reason }) => ({ score: reply_true ? 1 : 0, message: `Agentcard wrote "${answer.reply.slice(0, 200)}": ${reason}` })))
      .label("reply-is-true")
      .atLeast(1);
  }
  return answer;
}

const Grade = z.object({
  fitting: z.number().int().describe("How many of the products are something the shopper could reasonably want for this ask."),
  reply_true: z.boolean().describe("False only when the reply says something clearly untrue about the products shown."),
  reason: z.string().describe("One sentence naming the products that do not fit and anything untrue in the reply, or `all good`."),
});

/**
 * A model's reading of an answer against the shopper's words: how many of the products fit, and whether Agentcard's
 * reply beside them is true. Uses the same Anthropic key as the agent, on a smaller model.
 */
export async function gradeProducts(ask: string, answer: BuyAnswer) {
  const { output } = await generateText({
    model: anthropic("claude-haiku-5-5"),
    output: Output.object({ schema: Grade }),
    prompt: [
      "You grade a shopping assistant. A shopper typed an ask, and the assistant showed product cards and wrote a reply.",
      "Count a product as fitting when it is the kind of thing asked for and breaks nothing the shopper said: the brand, the model, the store, the budget, the size, the colour, a spec they named.",
      "A different pack size, colour or brand the shopper did not rule out still fits. An accessory for the thing asked for does not, and neither does the same thing for a different model.",
      "The reply is untrue only when it states something clearly wrong about the cards: a wrong price, a product that is not shown, or that the products fit the ask when most do not. Do not judge its tone, its length, its opinions such as `best value`, or how many questions it asks.",
      `Shopper's ask: ${ask}`,
      `Products shown: ${JSON.stringify(answer.products.map(({ name, store, price }) => ({ name, store, price })))}`,
      `Assistant's reply: ${answer.reply}`,
    ].join("\n\n"),
  });
  return { ...output, fitting: Math.min(Math.max(output.fitting, 0), answer.products.length) };
}
