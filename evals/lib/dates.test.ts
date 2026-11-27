import assert from "node:assert/strict";
import { test } from "node:test";
import { cardDays, daysFromNow, daysIn, inWindow, monthOf, thisWeekend } from "./dates.ts";

// A Thursday.
const now = new Date(2026, 10, 26, 15, 0, 0);

test("an ask's days are kept as calendar days", () => {
  assert.deepEqual(daysFromNow(21, 0, now), { from: "2026-12-17", to: "2026-12-17", words: "Thursday, December 17" });
  assert.deepEqual(daysFromNow(28, 2, now), { from: "2026-12-24", to: "2026-12-26", words: "Thursday, December 24 to Saturday, December 26" });
  assert.deepEqual(monthOf(45, now), { from: "2027-01-01", to: "2027-01-31", words: "January 2027" });
});

test("this weekend is the coming Friday to Sunday, or what is left of it", () => {
  assert.deepEqual(thisWeekend(now), { from: "2026-11-27", to: "2026-11-29", words: "this weekend" });
  assert.deepEqual(thisWeekend(new Date(2026, 10, 28)), { from: "2026-11-28", to: "2026-11-29", words: "this weekend" });
  assert.deepEqual(thisWeekend(new Date(2026, 10, 29)), { from: "2026-11-29", to: "2026-11-29", words: "this weekend" });
});

test("days are read however a card writes them, and a day with no year is its next coming one", () => {
  assert.deepEqual(daysIn("Sun, Nov 29 at 6:00 PM", now), ["2026-11-29"]);
  assert.deepEqual(daysIn("Jan 11: Denver Nuggets • Jan 14: Miami Heat", now), ["2027-01-11", "2027-01-14"]);
  assert.deepEqual(daysIn("November 29, 2026", now), ["2026-11-29"]);
  assert.deepEqual(daysIn("29 Nov", now), ["2026-11-29"]);
  assert.deepEqual(daysIn("2026-12-17T10:26:00", now), ["2026-12-17"]);
  assert.deepEqual(daysIn("pick up on Thu, Dec 17 at 10:00, return Sun, Dec 20 at 10:00", now), ["2026-12-17", "2026-12-20"]);
});

test("a time, a price and a product's numbers are never read as a day", () => {
  assert.deepEqual(daysIn("9:10am to 10:29pm · $247.20 · 1 stop via PSP", now), []);
  assert.deepEqual(daysIn("March 2026 collection, 12 pack", now), []);
  assert.deepEqual(daysIn("Marriott 5 star", now), []);
});

test("a card's day comes from the answer's field, then its words, then its page address", () => {
  assert.deepEqual(cardDays({ field: "2026-12-17T10:26:00", name: "Alaska Airlines: SFO→JFK", page: null }, now), { days: ["2026-12-17"], readFrom: "the answer's field" });
  assert.deepEqual(cardDays({ name: "Slam Frank, Sat, Nov 28 at 7:00 PM", page: null }, now), { days: ["2026-11-28"], readFrom: "the card's words" });
  assert.deepEqual(cardDays({ name: "Atlanta Hawks at New York Knicks", page: "https://www.example.com/new-york-knicks-new-york-tickets-11-29-2026/event/161658841/" }, now), { days: ["2026-11-29"], readFrom: "the card's page address" });
  assert.deepEqual(cardDays({ name: "Yoga for Nervous System Health", page: "https://www.example.com/classes/yoga#393465704-2026-11-29" }, now), { days: ["2026-11-29"], readFrom: "the card's page address" });
  assert.deepEqual(cardDays({ name: "Club Quarters Hotel, Central Loop, Chicago", page: null }, now), { days: [], readFrom: null });
});

test("a game in November is outside a month of January", () => {
  const january = monthOf(45, now);
  assert.ok(!inWindow("2026-11-29", january));
  assert.ok(inWindow("2027-01-28", january));
});
