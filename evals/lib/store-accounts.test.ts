import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_SHOPPER, savedAccountAt, testAccountAt } from "./store-accounts.ts";

test("a saved account counts only for the run of the shopper it was saved for, at a listed store", () => {
  assert.ok(testAccountAt("Target") && testAccountAt("McMaster-Carr"));
  assert.ok(savedAccountAt("Target, clothing in a size and a colour", { EVAL_SHOPPER_ID: ACCOUNT_SHOPPER }));
  assert.ok(!savedAccountAt("Sephora", { EVAL_SHOPPER_ID: ACCOUNT_SHOPPER }), "no account is saved at Sephora");
  assert.ok(!savedAccountAt("McMaster-Carr", {}), "a run where each chat is its own shopper has no account anywhere");
});
