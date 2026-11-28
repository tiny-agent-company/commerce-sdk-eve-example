import assert from "node:assert/strict";
import { test } from "node:test";
import { amountsIn, asksPasswordInChat, needsAccount, noRoomByCode, storeAnswerOf } from "./store-answer.ts";

test("a stop code that says sold out is the store's own answer, read from the field", () => {
  const answer = storeAnswerOf({ code: "product_out_of_stock", reply: "I couldn't add it.", booking: false });
  assert.equal(answer?.what, "out of stock");
  assert.equal(answer?.read_from, "the answer's fields");
  assert.equal(storeAnswerOf({ code: "variant_sold_out", reply: "", booking: false })?.what, "out of stock");
});

test("a code that says a supplier could not be reached is never the store's own answer", () => {
  assert.equal(storeAnswerOf({ code: "merchant_unavailable", reply: "I couldn't reach the store.", booking: true }), null);
  assert.equal(storeAnswerOf({ code: "catalog_unavailable", reply: "The catalog has no offer there.", booking: false }), null);
  assert.equal(storeAnswerOf({ code: "scroll_loop", reply: "I couldn't get through the store's checkout this time. Nothing was ordered or charged.", booking: false }), null);
  assert.equal(storeAnswerOf({ code: "total_unread", reply: "I reached the payment form but couldn't read its total, so I stopped.", booking: false }), null);
});

test("a price other than the card's is the store's own answer, from the cart's field, the code or the reading", () => {
  assert.equal(storeAnswerOf({ code: null, reply: "The store charges $30.00, not the $17.99 on the card. Still want it?", booking: false, priceChanged: true })?.read_from, "the answer's fields");
  assert.equal(storeAnswerOf({ code: "max_price_exceeded", reply: "", booking: false })?.what, "the store's price differs from the card's");
  const read = storeAnswerOf({ code: null, reply: "Macy's priced it at $30.00, which is more than the $17.99 on the card.", said: "price_differs", booking: false });
  assert.equal(read?.what, "the store's price differs from the card's");
  assert.equal(read?.read_from, "the reply's words");
});

test("a booking whose every card has no room, or no price to book at, has no seats", () => {
  const none = storeAnswerOf({ code: null, reply: "", booking: true, cards: [{ availability: null, price: null }, { availability: "unavailable", price: "$20.00" }] });
  assert.equal(none?.what, "no seats or availability");
  assert.equal(none?.read_from, "the answer's fields");
  // A free table shows no price and can still be booked.
  assert.equal(storeAnswerOf({ code: null, reply: "", booking: true, free: true, cards: [{ availability: "available", price: null }] }), null);
  assert.equal(storeAnswerOf({ code: null, reply: "", booking: true, cards: [{ availability: null, price: "$65.96" }, { availability: null, price: null }] }), null);
});

test("a sign-in step, link or code says the store needs the shopper's account", () => {
  assert.ok(needsAccount({ code: null, nextAction: "store_login", links: [] }));
  assert.ok(needsAccount({ code: null, nextAction: null, links: ["store_login"] }));
  assert.ok(needsAccount({ code: "account_required", nextAction: null, links: [] }));
  assert.ok(!needsAccount({ code: "sandbox_mode", nextAction: "confirm", links: ["approval"] }));
});

test("the page where the shopper gives their own store account is a sign-in step too", () => {
  assert.ok(needsAccount({ code: null, nextAction: "store_account", links: [] }));
  assert.ok(needsAccount({ code: null, nextAction: null, links: ["store_credentials"] }));
  assert.ok(!needsAccount({ code: null, nextAction: "shipping_details", links: ["product"] }));
});

test("a password asked for in the chat is told apart from one asked for on Agentcard's page", () => {
  assert.ok(asksPasswordInChat("Costco needs your account. Send me your Costco email and password here and I'll sign in."));
  assert.ok(asksPasswordInChat("What's your password for Target?"));
  assert.ok(!asksPasswordInChat("Costco needs your own account. Enter your email and password on this page, and I'll sign in for you."));
  assert.ok(!asksPasswordInChat("Never type your password in the chat. Costco texted you a code: send me the code here."));
  assert.ok(!asksPasswordInChat("Send me the 6-digit code Costco texted you."));
});

test("a booking's no_availability code is read first, before any words", () => {
  assert.ok(noRoomByCode("no_availability"));
  assert.ok(!noRoomByCode("merchant_unavailable"));
  const answer = storeAnswerOf({ code: "no_availability", reply: "The price changed to $40 for the 9am class.", booking: true });
  assert.equal(answer?.what, "no seats or availability");
  assert.equal(answer?.read_from, "the answer's fields");
});

test("amounts are read in cents, thousands and all", () => {
  assert.deepEqual(amountsIn("It's $1,069.00 with a $5.35 fee, about $226 a night."), [106900, 535, 22600]);
});

test("with no field for it, the reply's reading says what the store answered, and words alone say nothing", () => {
  const sold = storeAnswerOf({ code: null, reply: "Amazon no longer has the 8-pack in stock.", said: "out_of_stock", booking: false });
  assert.equal(sold?.what, "out of stock");
  assert.equal(sold?.read_from, "the reply's words");
  assert.equal(storeAnswerOf({ code: null, reply: "There's nothing to book for two in January.", said: "no_availability", booking: true })?.what, "no seats or availability");
  // A booking's seats are not a product's stock, and the other way round.
  assert.equal(storeAnswerOf({ code: null, reply: "None has two seats.", said: "no_availability", booking: false }), null);
  assert.equal(storeAnswerOf({ code: null, reply: "It is out of stock.", said: "out_of_stock", booking: true }), null);
  // No reading, no answer from words: the words are never matched against a list.
  assert.equal(storeAnswerOf({ code: null, reply: "The green hammer is out of stock.", booking: false }), null);
});

test("a checkout closed for now is the store's own answer when a way on is offered, the code first", () => {
  const moved = "B&H Photo Video's checkout is closed for now (it says: \"Checkout will be available at 11/28/2026, 5:45 PM ET Sat night\"), so I put the same Delkin 64GB card in your cart at Other Store at the same price, $29.99.";
  assert.equal(storeAnswerOf({ code: "checkout_closed", reply: moved, booking: false, offersNextStep: true })?.what, "the store's checkout is closed for now");
  assert.equal(storeAnswerOf({ code: "checkout_closed", reply: moved, booking: false, offersNextStep: true })?.read_from, "the answer's fields");
  assert.equal(storeAnswerOf({ code: "checkout_closed", reply: moved, booking: false })?.what, "the store's checkout is closed for now", "with no reading, the code alone says it");
  assert.equal(storeAnswerOf({ code: null, reply: moved, said: "checkout_closed", offersNextStep: true, booking: false })?.read_from, "the reply's words");
  // Closed, and the shopper is left with nothing to do: not the store's own answer.
  assert.equal(storeAnswerOf({ code: "checkout_closed", reply: "B&H's checkout is closed.", booking: false, offersNextStep: false }), null);
  assert.equal(storeAnswerOf({ code: null, reply: "B&H's checkout is closed.", said: "checkout_closed", offersNextStep: false, booking: false }), null);
});

test("an item no longer available while pricing is the store's own answer only with a way on", () => {
  const reply = "Ace Hardware's supplier says the Stanley hammer is no longer available, so nothing was ordered. Want me to look for it at another store?";
  assert.equal(storeAnswerOf({ code: null, reply, said: "no_longer_available", offersNextStep: true, booking: false })?.what, "the item is no longer available");
  assert.equal(storeAnswerOf({ code: null, reply: "The item is no longer available.", said: "no_longer_available", offersNextStep: false, booking: false }), null);
});

test("Agentcard's own reading of a store page is never the store saying the item is no longer available", () => {
  const reply = "McMaster-Carr no longer shows 18-8 Stainless Steel Socket Head Screw on its page, so I stopped before adding anything in its place. Nothing was ordered or charged. Want me to look for it at another store?";
  assert.equal(storeAnswerOf({ code: "product_not_found", reply, said: "no_longer_available", offersNextStep: true, booking: false }), null);
  assert.equal(storeAnswerOf({ code: "off_product_page", reply, said: "no_longer_available", offersNextStep: true, booking: false }), null);
  assert.equal(storeAnswerOf({ code: null, reply, said: "no_longer_available", offersNextStep: true, booking: false })?.what, "the item is no longer available");
});
