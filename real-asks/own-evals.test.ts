import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnEvalAsk, ownEvalAsks } from "./own-evals.ts";

test("knows the messages this repository's own evals send, however they are cased or punctuated", () => {
  const asks = ownEvalAsks();
  assert.ok(asks.size > 80);
  assert.ok(isOwnEvalAsk("wireless earbuds", asks));
  assert.ok(isOwnEvalAsk("  A yoga mat under $30. ", asks));
  assert.ok(isOwnEvalAsk("hi! what can you do?", asks));
  assert.ok(isOwnEvalAsk("a backpack", asks));
  assert.ok(!isOwnEvalAsk("a left-handed titanium spork for my camping trip", asks));
});
