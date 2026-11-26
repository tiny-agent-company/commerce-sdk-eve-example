import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAFT, draftsWaiting, readRow, REJECTED, REVIEWED, rowsToRun, type RealAsk } from "../evals/lib/real-asks.ts";

// Every row here is made up.
const row = (id: string, review: string, day: string): RealAsk => ({ id, messages: ["a yoga mat"], wants: [{ what: "yoga mat", must: ["a yoga mat"] }], mayAsk: false, priced: true, pickedFor: [], day, kind: "retail", review });

test("reads a dataset row, and refuses one with no ask or no requirements", () => {
  const read = readRow({ id: "real-1", input: { messages: ["a yoga mat under $30"] }, expected: { wants: [{ what: "yoga mat", must: ["a yoga mat", "costs under $30"] }], may_ask: true }, metadata: { day: "2026-01-01", kind: "retail", picked_for: ["rephrased"] } });
  assert.deepEqual(read, { id: "real-1", messages: ["a yoga mat under $30"], wants: [{ what: "yoga mat", must: ["a yoga mat", "costs under $30"] }], mayAsk: true, priced: true, context: undefined, pickedFor: ["rephrased"], day: "2026-01-01", kind: "retail", review: DRAFT });
  assert.equal(readRow({ id: "real-2", input: { messages: [] }, expected: { wants: [{ what: "x", must: [] }] } }), null);
  assert.equal(readRow({ id: "real-3", input: { messages: ["a yoga mat"] }, expected: {} }), null);
});

const rows = [row("a", DRAFT, "2026-01-01"), row("b", DRAFT, "2026-01-03"), row("c", REVIEWED, "2026-01-02"), row("d", REJECTED, "2026-01-04"), row("e", REVIEWED, "2026-01-05")];

test("runs only reviewed rows, the newest first, and no more than the limit", () => {
  assert.deepEqual(rowsToRun(rows, 10).map((made) => made.id), ["e", "c"]);
  assert.deepEqual(rowsToRun(rows, 1).map((made) => made.id), ["e"]);
  assert.deepEqual(rowsToRun(rows, 0), []);
  assert.equal(draftsWaiting(rows), 2);
});

test("runs drafts too when asked, after the reviewed rows, and never a rejected one", () => {
  assert.deepEqual(rowsToRun(rows, 10, true).map((made) => made.id), ["e", "c", "b", "a"]);
});

test("reads any review value it does not know as a draft, so a typo never makes a row run", () => {
  const read = (review: unknown) => readRow({ id: "r", input: { messages: ["a yoga mat"] }, expected: { wants: [{ what: "yoga mat", must: [] }] }, metadata: { review } })!.review;
  assert.equal(read("Reviewed "), REVIEWED);
  assert.equal(read("rejected"), REJECTED);
  assert.equal(read("looks fine"), DRAFT);
  assert.equal(read(undefined), DRAFT);
});
