import assert from "node:assert/strict";
import { test } from "node:test";
import { amountsNotTheCarts, slowToPrice, stillPricing, type Answer, type Step } from "./purchase.ts";

const cart = (total: string, more: Partial<NonNullable<Answer["cart"]>> = {}): NonNullable<Answer["cart"]> => ({
  store: "Best Buy",
  items: [{ product_id: "p1", name: "6 ft HDMI cable", qty: 1, price: "$47.97", line_total: "$47.97" }],
  fees: null,
  total,
  total_is_estimate: true,
  ...more,
});

const step = (said: string, reply: string, answerCart: Answer["cart"] = null, status = "needs_input"): Step =>
  ({ said, turn: {} as Step["turn"], snapshot: null, answer: { status, next_action: null, reply, cart: answerCart } }) as Step;

test("a reply that shows a cart quotes only the cart's own amounts", () => {
  const picked = { id: "p1", name: "6 ft HDMI cable", store: "Best Buy", price: "$47.97" } as never;
  const good = [step("415-555-0137", "Got it, it ships to 1 Ferry Plz. It's about $49.17 before tax and shipping; the card is held for at most $61.31, and only the store's exact total is charged. Say yes to place the order.", cart("$49.17", { max_charge: "$61.31" }))];
  assert.deepEqual(amountsNotTheCarts({ steps: good, picked, switchedFrom: [] }), []);
  const wrong = [step("1 Ferry Building, San Francisco, CA 94111", "Added the HDMI cable, about $24.84 before tax and shipping.", cart("$47.97"))];
  assert.equal(amountsNotTheCarts({ steps: wrong, picked, switchedFrom: [] }).length, 1);
  assert.match(amountsNotTheCarts({ steps: wrong, picked, switchedFrom: [] })[0]!, /\$24\.84/);
});

test("one night of a two-night stay, and an amount the shopper typed, are fair to quote", () => {
  const room = cart("$474.00", { items: [{ product_id: "r1", name: "King Room, 2 nights", qty: 1, price: "$474.00", line_total: "$474.00" }] });
  const steps = [step("I want number 1: King Room", "The King Room is $237.00 a night, $474.00 for both nights. Say yes to book it.", room)];
  assert.deepEqual(amountsNotTheCarts({ steps, picked: null, switchedFrom: [] }), []);
  const typed = [step("yes, place the order for $49.17", "Placing it at $49.17.", cart("$49.17"))];
  assert.deepEqual(amountsNotTheCarts({ steps: typed, picked: null, switchedFrom: [] }), []);
});

test("a cart still being priced is read from its field first, and from \"being priced\" when it has none", () => {
  assert.ok(stillPricing({ status: "needs_input", next_action: null, reply: "Here's your cart.", cart: cart("$49.17", { pricing: true }) }));
  assert.ok(stillPricing({ status: "needs_input", next_action: null, reply: "Your order is still being priced by eBay.", cart: cart("$49.17") }));
  assert.ok(!stillPricing({ status: "needs_input", next_action: null, reply: "Your total is $52.10.", cart: cart("$52.10") }));
});

test("a store slow to price is its own answer only when Agentcard kept the shopper told and offered another way", () => {
  const pricing = cart("$49.17", { pricing: true });
  const told = [step("yes", "Wayfair is still pricing your order (2 minutes so far).", pricing), step("any update?", "Still pricing, 6 minutes now. Want to keep waiting, or should I look at another store?", pricing), step("keep waiting", "Still waiting on Wayfair's total, 10 minutes so far.", pricing)];
  const answer = slowToPrice(told, 10 * 60_000, "after the yes");
  assert.equal(answer?.what, "the store was slow to price");
  assert.equal(answer?.read_from, "the answer's fields");
  const untold = [step("yes", "Wayfair is still pricing your order.", pricing), step("any update?", "", pricing), step("any update?", "Still pricing.", pricing)];
  assert.equal(slowToPrice(untold, 10 * 60_000, "after the yes"), null);
  const neverOffered = [step("yes", "Still pricing.", pricing), step("any update?", "Still pricing, 9 minutes.", pricing)];
  assert.equal(slowToPrice(neverOffered, 10 * 60_000, "after the yes"), null);
});
