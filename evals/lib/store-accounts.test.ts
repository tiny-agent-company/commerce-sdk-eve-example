import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_SHOPPER, savedAccountAt, testAccountAt } from "./store-accounts.ts";

test("a saved account counts only for the run of the shopper it was saved for, at a listed store", () => {
  assert.ok(!testAccountAt("Target"));
  assert.ok(!savedAccountAt("Target", { EVAL_SHOPPER_ID: ACCOUNT_SHOPPER }), "no account is saved at Target");
  assert.ok(!savedAccountAt("McMaster-Carr", {}), "a run where each chat is its own shopper has no account anywhere");
});
