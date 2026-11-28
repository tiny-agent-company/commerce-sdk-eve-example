import assert from "node:assert/strict";
import { test } from "node:test";
import { readyForTheYes, slowToPrice, stillPricing, wrongAmounts, type Answer, type Step } from "./purchase.ts";
import { readReply, useReader, type Reading } from "./reply-reader.ts";

const cart = (total: string, more: Partial<NonNullable<Answer["cart"]>> = {}): NonNullable<Answer["cart"]> => ({
  store: "Best Buy",
  items: [{ product_id: "p1", name: "6 ft HDMI cable", qty: 1, price: "$20.77", line_total: "$20.77" }],
  fees: "$0.52",
  total,
  total_is_estimate: true,
  ...more,
});

const read = (more: Partial<Reading> = {}): Reading => ({ asks: "nothing", pricing: null, stillWorking: false, quotesTheCharge: false, wrongAmounts: [], details: [], refused: [], choices: [], fits: [], alreadySaid: [], products: [], offerAt: null, storeSays: null, offersNextStep: false, ...more });

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
