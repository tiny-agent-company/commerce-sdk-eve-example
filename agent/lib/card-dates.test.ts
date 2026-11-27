import assert from "node:assert/strict";
import { test } from "node:test";
import { cardDates } from "./card-dates.ts";

test("a flight's card is dated by its first departure, under the id the card carries", () => {
  const dates = cardDates([{ id: "offer-1", ref: "p_1", flight: { legs: [{ departureAt: "2026-12-17T10:26:00" }, { departureAt: "2026-12-17T15:00:00" }] } }]);
  assert.deepEqual(dates, { p_1: "2026-12-17T10:26:00" });
});

test("a table's card is dated by the time it was searched for, read from Agentcard's own answer", () => {
  const dates = cardDates([{ id: "https://example.com/r/1", ref: "p_2" }], { catalog: { items: [{ id: "https://example.com/r/1", ref: "p_2", reservation: { searchedDatetime: "2026-12-03T19:00:00" } }] } });
  assert.deepEqual(dates, { p_2: "2026-12-03T19:00:00" });
});

test("an event's card is dated by its start at the venue", () => {
  const dates = cardDates([{ id: "e1", ref: "p_4" }], { catalog: { items: [{ id: "e1", ref: "p_4", startsAt: "2026-11-28T19:00" }] } });
  assert.deepEqual(dates, { p_4: "2026-11-28T19:00" });
});

test("a card whose answer names no time is left out", () => {
  assert.deepEqual(cardDates([{ id: "a", ref: "p_3" }], { catalog: { items: [{ id: "a", ref: "p_3" }] } }), {});
  assert.deepEqual(cardDates(undefined), {});
});
