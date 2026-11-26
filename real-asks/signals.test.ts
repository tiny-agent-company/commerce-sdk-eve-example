import assert from "node:assert/strict";
import { test } from "node:test";
import type { Day, Message } from "./read.ts";
import { picks, signsOf, turnsOf } from "./signals.ts";

// Every conversation here is made up.
const turn = (tools: string[], status = "needs_input") => ({ status, nextAction: null, declineCode: null, errorCode: null, tools, cart: false, ordered: false });
const message = (id: string, conversation: string, role: Message["role"], body: string, minute: number, handed: Message["turn"] = null): Message => ({ id, conversation, role, body, at: new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString(), tapped: false, turn: handed });
const conversation = (id: string, productsFor: string | null = null, products: Day["conversations"][number]["products"] = []) => ({ id, shopper: "s", company: "c", client: null, sandbox: false, productsFor, products });

const day: Day = {
  day: "2026-01-01",
  counts: { all: 5, testMode: 0, ownCompany: 0, skippedCompany: 0, skippedClient: 0, skippedShopper: 0, machine: 0, read: 5 },
  checkouts: [],
  conversations: [conversation("found", "f1", [{ name: "Yoga mat", store: "Amazon", price: "$20.00" }]), conversation("again"), conversation("wrong"), conversation("empty"), conversation("silent")],
  messages: [
    message("f1", "found", "visitor", "a yoga mat under $30", 0),
    message("f2", "found", "agent", "Here are three yoga mats.", 1, turn(["buy_search_products"])),
    message("a1", "again", "visitor", "waterproof hiking backpack under $50", 0),
    message("a2", "again", "agent", "Here are some backpacks.", 1, turn(["buy_search_products"])),
    message("a3", "again", "visitor", "a hiking backpack that is waterproof, under $50", 3),
    message("a4", "again", "agent", "Here are some more.", 4, turn(["buy_search_products"])),
    message("w1", "wrong", "visitor", "an iPhone 16 screen protector", 0),
    message("w2", "wrong", "agent", "Here are some screen protectors.", 1, turn(["buy_search_products"])),
    message("w3", "wrong", "visitor", "that's not what I asked for, those are for the Pro Max", 2),
    message("w4", "wrong", "agent", "Sorry, here are the right ones.", 3, turn(["buy_search_products"])),
    message("e1", "empty", "visitor", "a left-handed titanium spork", 0),
    message("e2", "empty", "agent", "I couldn't find a left-handed titanium spork.", 1, turn(["buy_search_products"])),
    message("s1", "silent", "visitor", "wireless earbuds", 0),
  ],
};

test("reads each sign from a conversation that shows it", () => {
  const signs = Object.fromEntries(turnsOf(day).map((made) => [made.ask.id, signsOf(made, false)]));
  assert.deepEqual(picks(signs.f1!), []);
  assert.deepEqual(signs.f1, ["left after the first answer"]);
  assert.deepEqual(picks(signs.a1!), ["rephrased"]);
  assert.deepEqual(picks(signs.w1!), ["said it was wrong"]);
  assert.deepEqual(picks(signs.e1!), ["nothing found"]);
  assert.deepEqual(picks(signs.s1!), ["no answer"]);
});

test("ties the stored products to the message they answer", () => {
  const turns = turnsOf(day);
  assert.equal(turns.find((made) => made.ask.id === "f1")!.products!.length, 1);
  assert.equal(turns.find((made) => made.ask.id === "a1")!.products, null);
});

test("a checkout that failed is counted and picks nothing", () => {
  const failed = turnsOf(day).find((made) => made.ask.id === "f1")!;
  assert.deepEqual(picks(signsOf(failed, true)), []);
  assert.ok(signsOf(failed, true).includes("checkout failed"));
});
