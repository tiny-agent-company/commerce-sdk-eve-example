import assert from "node:assert/strict";
import { test } from "node:test";
import { amountsIn, needsAccount, offersAnotherStore, storeAnswerOf } from "./store-answer.ts";

test("a stop code that says sold out is the store's own answer, read from the field", () => {
  const answer = storeAnswerOf({ code: "product_out_of_stock", reply: "I couldn't add it.", booking: false });
  assert.equal(answer?.what, "out of stock");
  assert.equal(answer?.read_from, "the answer's fields");
  assert.equal(storeAnswerOf({ code: "variant_sold_out", reply: "", booking: false })?.what, "out of stock");
});

test("out of stock with no code is read from the reply's words, and says so", () => {
  const answer = storeAnswerOf({ code: null, reply: "The store just told me the green hammer is out of stock, so I didn't place the order and you weren't charged.", booking: false });
  assert.equal(answer?.what, "out of stock");
  assert.equal(answer?.read_from, "the reply's words");
});

test("a code that says a supplier could not be reached is never the store's own answer", () => {
  assert.equal(storeAnswerOf({ code: "merchant_unavailable", reply: "I couldn't reach the store.", booking: true }), null);
  assert.equal(storeAnswerOf({ code: "catalog_unavailable", reply: "The catalog has no offer there.", booking: false }), null);
  assert.equal(storeAnswerOf({ code: "scroll_loop", reply: "I couldn't get through the store's checkout this time. Nothing was ordered or charged.", booking: false }), null);
  assert.equal(storeAnswerOf({ code: "total_unread", reply: "I reached the payment form but couldn't read its total, so I stopped.", booking: false }), null);
});

test("words about what is not available to order are not a stock answer", () => {
  assert.equal(storeAnswerOf({ code: null, reply: "That one isn't available to order there.", booking: false }), null);
  assert.equal(storeAnswerOf({ code: null, reply: "Number 6 has size M in stock, want me to add it?", booking: false }), null);
});

test("a price other than the card's is the store's own answer, from the cart's field or the code", () => {
  assert.equal(storeAnswerOf({ code: null, reply: "The store charges $30.00, not the $17.99 on the card. Still want it?", booking: false, priceChanged: true })?.read_from, "the answer's fields");
  assert.equal(storeAnswerOf({ code: "max_price_exceeded", reply: "", booking: false })?.what, "the store's price differs from the card's");
  const worded = storeAnswerOf({ code: null, reply: "Macy's priced it at $30.00, which is more than the $17.99 on the card. Do you still want it?", booking: false });
  assert.equal(worded?.what, "the store's price differs from the card's");
  assert.equal(worded?.read_from, "the reply's words");
});

test("a booking whose every card has no room, or no price to book at, has no seats", () => {
  const none = storeAnswerOf({ code: null, reply: "", booking: true, cards: [{ availability: null, price: null }, { availability: "unavailable", price: "$20.00" }] });
  assert.equal(none?.what, "no seats or availability");
  assert.equal(none?.read_from, "the answer's fields");
  // A free table shows no price and can still be booked.
  assert.equal(storeAnswerOf({ code: null, reply: "", booking: true, free: true, cards: [{ availability: "available", price: null }] }), null);
  assert.equal(storeAnswerOf({ code: null, reply: "", booking: true, cards: [{ availability: null, price: "$65.96" }, { availability: null, price: null }] }), null);
});

test("no seats with no field is read from the reply's words, for a booking only", () => {
  const reply = "It lists eight home games in January, but none has two seats available together right now.";
  assert.equal(storeAnswerOf({ code: null, reply, booking: true })?.what, "no seats or availability");
  assert.equal(storeAnswerOf({ code: null, reply, booking: false }), null);
});

test("a sign-in step, link or code says the store needs the shopper's account", () => {
  assert.ok(needsAccount({ code: null, nextAction: "store_login", links: [] }));
  assert.ok(needsAccount({ code: null, nextAction: null, links: ["store_login"] }));
  assert.ok(needsAccount({ code: "account_required", nextAction: null, links: [] }));
  assert.ok(!needsAccount({ code: "sandbox_mode", nextAction: "confirm", links: ["approval"] }));
});

test("another store offered beside the sign-in is read from the answer's stores, else from its words", () => {
  assert.deepEqual(offersAnotherStore("Sephora needs an account to check out. Sign in once through this link.", ["Ulta Beauty"]), { offered: true, readFrom: "the answer's fields" });
  assert.equal(offersAnotherStore("Sephora needs an account to check out. Sign in once, or I can get the same serum from another store with no account.", []).readFrom, "the reply's words");
  assert.equal(offersAnotherStore("Sephora needs an account to check out. Sign in once through this link, then reply that you're done.", []).offered, false);
});

test("amounts are read in cents, thousands and all", () => {
  assert.deepEqual(amountsIn("It's $1,069.00 with a $5.35 fee, about $226 a night."), [106900, 535, 22600]);
});
