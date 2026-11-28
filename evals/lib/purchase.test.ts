import assert from "node:assert/strict";
import { test } from "node:test";
import { readyForTheYes, slowToPrice, stillPricing, wrongAmounts, type Answer, type Purchase, type Step } from "./purchase.ts";
import { readReply, useReader, type Reading } from "./reply-reader.ts";

const cart = (total: string, more: Partial<NonNullable<Answer["cart"]>> = {}): NonNullable<Answer["cart"]> => ({
  store: "Best Buy",
  items: [{ product_id: "p1", name: "6 ft HDMI cable", qty: 1, price: "$20.77", line_total: "$20.77" }],
  fees: "$0.52",
  total,
  total_is_estimate: true,
  ...more,
});

const read = (more: Partial<Reading> = {}): Reading => ({ asks: "nothing", pricing: null, stillWorking: false, quotesTheCharge: false, wrongAmounts: [], details: [], refused: [], choices: [], fits: [], alreadySaid: [], products: [], offerAt: null, storeSays: null, offersNextStep: false, charges: [], ...more });

const step = (said: string, reply: string, answerCart: Answer["cart"], reading: Reading | null, next: string | null = null): Step =>
  ({ said, turn: {} as Step["turn"], snapshot: null, reading, answer: { status: "needs_input", next_action: next, reply, cart: answerCart } }) as Step;

test("the yes is read from the confirm step, or from the reply's reading in any words", () => {
  assert.ok(readyForTheYes(step("415-555-0137", "Say yes to buy it at that price.", cart("$41.65"), read({ asks: "pay_or_book" }))));
  assert.ok(readyForTheYes(step("415-555-0137", "Anything else?", cart("$41.65"), read(), "confirm")));
  assert.ok(!readyForTheYes(step("1 Ferry Building", "Is it 1 Ferry Plz? Say yes, or send me the right address.", cart("$21.29"), read({ asks: "confirm_address" }))));
  assert.ok(!readyForTheYes(step("a cable", "Want me to add it?", null, read({ asks: "add_to_cart" }))));
});

test("a cart still pricing is read from its field first, and from the reply's reading when it has none", () => {
  assert.ok(stillPricing(step("yes", "Here's your cart.", cart("$21.29", { pricing: true }), null)));
  assert.ok(stillPricing(step("yes", "Your order is still being priced by eBay.", cart("$21.29"), read({ pricing: "still_pricing" }))));
  assert.ok(!stillPricing(step("yes", "Your total is $22.10.", cart("$22.10"), read())));
  assert.ok(!stillPricing(step("yes", "Still pricing.", cart("$22.10"), null)), "with no field and no reading, nothing says it is pricing");
});

test("a store slow to price is its own answer only when Agentcard kept the shopper told and offered another way", () => {
  const pricing = cart("$49.17", { pricing: true });
  const told = [
    step("yes", "Wayfair is still pricing your order (2 minutes so far).", pricing, read({ pricing: "still_pricing" })),
    step("any update?", "Still pricing, 6 minutes now. Want to keep waiting, or should I look at another store?", pricing, read({ asks: "keep_waiting_or_another_store", pricing: "still_pricing" })),
    step("keep waiting", "Still waiting on Wayfair's total, 10 minutes so far.", pricing, read({ pricing: "still_pricing" })),
  ];
  const answer = slowToPrice(told, 10 * 60_000, "after the yes");
  assert.equal(answer?.what, "the store was slow to price");
  assert.equal(answer?.read_from, "the answer's fields");
  const untold = [step("yes", "Still pricing.", pricing, read({ pricing: "still_pricing" })), step("any update?", "", pricing, read()), step("any update?", "Still pricing.", pricing, read({ pricing: "still_pricing" }))];
  assert.equal(slowToPrice(untold, 10 * 60_000, "after the yes"), null);
  const neverOffered = [step("yes", "Still pricing.", pricing, read({ pricing: "still_pricing" })), step("any update?", "Still pricing, 9 minutes.", pricing, read({ pricing: "still_pricing" }))];
  assert.equal(slowToPrice(neverOffered, 10 * 60_000, "after the yes"), null);
});

test("a wrong amount is one the reader says the cart contradicts, on a reply that shows a cart", () => {
  const steps = [
    step("I want number 1", "Added the cable, about $24.84 estimated.", cart("$21.29"), read({ wrongAmounts: [{ amount: "$24.84", why: "the cart's estimate is $21.29" }] })),
    step("415-555-0137", "Shipping is $12.95, so with $0.69 tax it comes to $21.63.", cart("$21.63"), read()),
    step("a cable", "It's $24.84.", null, read({ wrongAmounts: [{ amount: "$24.84", why: "no cart" }] })),
  ];
  const wrong = wrongAmounts({ steps });
  assert.equal(wrong.length, 1);
  assert.match(wrong[0]!, /\$24\.84/);
});

test("a reply is read once, and a reader that keeps failing leaves the answer to its fields", async () => {
  let calls = 0;
  const before = useReader(async () => {
    calls++;
    return read({ asks: "pay_or_book" });
  });
  try {
    const input = { reply: "Say yes to place the order.", cart: null, nextAction: null, earlier: [] };
    assert.equal((await readReply(input))?.asks, "pay_or_book");
    assert.equal((await readReply(input))?.asks, "pay_or_book");
    assert.equal(calls, 1);
    useReader(async () => {
      throw new Error("overloaded");
    });
    const notes: string[] = [];
    assert.equal(await readReply({ ...input, reply: "Other words." }, (line) => notes.push(line)), null);
    assert.equal(notes.length, 1);
  } finally {
    useReader(before);
  }
});

test("a cart's total is explained by its lines and the charges named, and never covers products not on it", async () => {
  const { totalNotExplained, madeOf } = await import("./purchase.ts");
  const one = (price: string, total: string, more: Partial<NonNullable<Answer["cart"]>> = {}): NonNullable<Answer["cart"]> => ({ store: "Costco", items: [{ product_id: "p1", name: "Olive oil", qty: 1, price, line_total: price }], fees: null, total, total_is_estimate: false, ...more });
  const cards = [{ price: "$30.99" }, { price: "$20.99" }] as Purchase["cards"];
  // Costco, 2026-11-28: the store's price is the card's plus whole other bottles.
  const doubled = [step("yes", "Costco charges $61.98 for it now, so it comes to $67.98.", one("$61.98", "$67.98", { price_change: { card_price: "$30.99", store_price: "$61.98", heads_up: "" } }), read())];
  assert.match(totalNotExplained({ steps: doubled, cards })[0]!, /\$30\.99/);
  const mixed = [step("yes", "Costco charges $82.97 for it now.", one("$82.97", "$82.97", { price_change: { card_price: "$20.99", store_price: "$82.97", heads_up: "" } }), read())];
  assert.match(totalNotExplained({ steps: mixed, cards })[0]!, /2 x \$30\.99/);
  // A total two of the line, with nothing else to explain it.
  assert.equal(totalNotExplained({ steps: [step("yes", "It comes to $61.98.", one("$30.99", "$61.98"), read())], cards: [] }).length, 1);
  // Shipping and tax named in the reply explain the total; unnamed tax and shipping are not counted against it.
  assert.deepEqual(totalNotExplained({ steps: [step("x", "Shipping is $12.95, so with $0.69 tax it comes to $21.63.", one("$7.99", "$21.63"), read({ charges: [{ kind: "shipping", amount: "$12.95" }, { kind: "tax", amount: "$0.69" }] }))], cards: [] }), []);
  assert.deepEqual(totalNotExplained({ steps: [step("x", "It comes to $33.99 with tax and shipping.", one("$30.99", "$33.99"), read())], cards }), []);
  // An estimate is its lines and its fees.
  assert.deepEqual(totalNotExplained({ steps: [step("x", "About $21.29.", cart("$21.29"), read())], cards: [] }), []);
  assert.equal(totalNotExplained({ steps: [step("x", "About $24.84.", cart("$24.84"), read())], cards: [] }).length, 1);
  // Bottles left by another chat: the price is nearly four times the card's, and no product of this chat makes it up.
  const leftover = [step("yes", "Costco charges $111.46 for it now.", one("$111.46", "$111.46", { price_change: { card_price: "$28.49", store_price: "$111.46", heads_up: "" } }), read())];
  assert.match(totalNotExplained({ steps: leftover, cards: [{ price: "$28.49" }, { price: "$30.99" }] as Purchase["cards"] })[0]!, /3\.9 times the card's \$28\.49/);
  // A store price a little above the card's is the store's own answer, not this check's.
  assert.deepEqual(totalNotExplained({ steps: [step("yes", "Best Buy charges $26.60.", one("$26.60", "$29.61", { price_change: { card_price: "$26.45", store_price: "$26.60", heads_up: "" } }), read())], cards: [] }), []);
  assert.equal(madeOf(6198, [3099]), "2 x $30.99");
  assert.equal(madeOf(1234, [3099, 2099]), null);
});
