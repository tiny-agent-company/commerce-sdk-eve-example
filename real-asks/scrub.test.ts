import assert from "node:assert/strict";
import { test } from "node:test";
import { alike, scrub, stillHolds } from "./scrub.ts";

// Every message here is made up.
test("removes links, emails, phone numbers, card numbers and ids", () => {
  assert.equal(scrub("buy this https://www.example.com/dp/B0ABC?ref=me please"), "buy this [link] please");
  assert.equal(scrub("see example.com/p/123 and www.shop.example/x"), "see [link] and [link]");
  assert.equal(scrub("send the receipt to jane.doe+shop@example.co.uk"), "send the receipt to [email]");
  assert.equal(scrub("call me at +1 (415) 555-0100 when it ships"), "call me at [number] when it ships");
  assert.equal(scrub("use card 4242 4242 4242 4242"), "use card [number]");
  assert.equal(scrub("where is order #A1B2-99871?"), "where is order #[order id]?");
  assert.equal(scrub("my tracking number is 1Z999AA10123456784"), "my tracking number is [order id]");
  assert.equal(scrub("user usr_0123456789abcdef01234567 in 11111111-2222-4333-8444-555555555555"), "user [id] in [id]");
});

test("removes street addresses and keeps the city and postcode", () => {
  assert.equal(scrub("deliver to 500 Example Street, San Francisco, CA 94105"), "deliver to 123 Main St, San Francisco, CA 94105");
  assert.equal(scrub("ship it to 42 Oak Tree Ave, Apt 5B, Austin TX"), "ship it to 123 Main St, Austin TX");
  assert.equal(scrub("entregar en Calle de Alcalá 45, Madrid"), "entregar en Calle Mayor 1, Madrid");
  assert.equal(scrub("Lieferung an Hauptstraße 12, Berlin"), "Lieferung an Hauptstraße 1, Berlin");
});

test("leaves an ordinary ask as typed", () => {
  for (const ask of ["a 27 inch 4K monitor with USB-C under $300", "Sony WH-1000XM5 headphones from nike.com", "2 cans of dr pepper and 5 st ives scrubs", "men's black running shoes size 10", "a dozen eggs and a gallon of milk", "iPhone 16 Pro Max 256GB case, 3 pack"]) {
    assert.equal(scrub(ask), ask);
    assert.equal(stillHolds(ask), false);
  }
});

test("tells an ask asked again from a different ask", () => {
  assert.ok(alike("black running shoes size 10", "running shoes in black, size 10 please") >= 0.8);
  assert.ok(alike("black running shoes size 10", "a cast iron skillet") === 0);
});
