/**
 * The days a booking's ask names, and the days a card or a booking is for.
 *
 * Every booking that has a date (a flight, a room, a rental car, a table, a class, a ticket, an event) is asked for with
 * one: a day, a few nights from a day, a month, or "this weekend". The evals keep those days beside the ask as a
 * `Window`, and check each card shown and the booking held against it. A game in November offered for "a game in
 * January" (2026-11-26) is what this catches.
 *
 * A day here is a calendar day as it is written, `2026-12-17`, with no time zone: a card says "Dec 17" for the day at
 * the venue, and the shopper asked for that day by name.
 */

/** The first and the last day an ask names, both included, and the words the ask used. */
export interface Window {
  from: string;
  to: string;
  words: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const two = (value: number) => String(value).padStart(2, "0");

/** A date as its calendar day, `2026-12-17`, in the clock of the machine that runs the evals, which is the clock the asks are worded in. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

const plusDays = (now: Date, count: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + count);

/** One day a number of days out, or that day and the nights after it: "two nights from Thursday" is three days, the last one the day they leave. */
export function daysFromNow(first: number, nights = 0, now = new Date()): Window {
  const from = plusDays(now, first);
  const to = plusDays(now, first + nights);
  const worded = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return { from: dayOf(from), to: dayOf(to), words: nights > 0 ? `${worded(from)} to ${worded(to)}` : worded(from) };
}

/** The whole month a number of days out: "a game in January". */
export function monthOf(daysOut: number, now = new Date()): Window {
  const inMonth = plusDays(now, daysOut);
  const from = new Date(inMonth.getFullYear(), inMonth.getMonth(), 1);
  const to = new Date(inMonth.getFullYear(), inMonth.getMonth() + 1, 0);
  return { from: dayOf(from), to: dayOf(to), words: inMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
}

/** "This weekend": the coming Friday to Sunday, or what is left of them when the eval runs on one of those days. */
export function thisWeekend(now = new Date()): Window {
  const weekday = now.getDay();
  const toSunday = weekday === 0 ? 0 : 7 - weekday;
  const from = weekday === 0 || weekday >= 5 ? plusDays(now, 0) : plusDays(now, 5 - weekday);
  const to = plusDays(now, toSunday);
  return { from: dayOf(from), to: dayOf(to), words: "this weekend" };
}

/** True when a calendar day is one of the days the ask names. */
export function inWindow(day: string, window: Window): boolean {
  return day >= window.from && day <= window.to;
}

/**
 * Every calendar day a text names, in the order it names them, each once: `2026-11-29`, `11-29-2026`, `11/29/2026`,
 * `Nov 29`, `November 29, 2026`, `29 Nov`. A day written with no year is read as its next coming one, counted from a
 * week ago, so "Nov 29" read on November 26 is this year's and "Jan 11" is next year's. A time such as "7:00 PM" and a
 * price are never read as a day.
 */
export function daysIn(text: string, now = new Date()): string[] {
  const found: { at: number; day: string }[] = [];
  const valid = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year < 2100;
  const keep = (at: number, year: number, month: number, day: number) => {
    if (valid(year, month, day)) found.push({ at, day: `${year}-${two(month)}-${two(day)}` });
  };
  /** The year of a day written without one: the next time that day comes, counted from a week ago. */
  const yearFor = (month: number, day: number) => {
    const weekAgo = plusDays(now, -7);
    const thisYear = new Date(now.getFullYear(), month - 1, day);
    return thisYear >= weekAgo ? now.getFullYear() : now.getFullYear() + 1;
  };
  for (const hit of text.matchAll(/(?<!\d)(20\d\d)-(\d\d)-(\d\d)(?!\d)/g)) keep(hit.index, Number(hit[1]), Number(hit[2]), Number(hit[3]));
  for (const hit of text.matchAll(/(?<![\d$.])(\d{1,2})[-/](\d{1,2})[-/](20\d\d)(?!\d)/g)) keep(hit.index, Number(hit[3]), Number(hit[1]), Number(hit[2]));
  const month = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  for (const hit of text.matchAll(new RegExp(`\\b${month}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(20\\d\\d))?`, "gi"))) {
    const number = MONTHS.indexOf(hit[1]!.slice(0, 3).toLowerCase()) + 1;
    keep(hit.index, hit[3] ? Number(hit[3]) : yearFor(number, Number(hit[2])), number, Number(hit[2]));
  }
  for (const hit of text.matchAll(new RegExp(`(?<![\\d:$.])(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}\\b\\.?(?:,?\\s+(20\\d\\d))?`, "gi"))) {
    const number = MONTHS.indexOf(hit[2]!.slice(0, 3).toLowerCase()) + 1;
    keep(hit.index, hit[3] ? Number(hit[3]) : yearFor(number, Number(hit[1])), number, Number(hit[1]));
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((one) => one.day)
    .filter((day) => (seen.has(day) ? false : (seen.add(day), true)));
}

/** What a card says about when it is, in the order of how much it can be trusted. */
export interface CardWhen {
  /** The time Agentcard's answer names for the card, such as a flight's first departure, as `2026-12-17T10:26:00`. */
  field?: string | null;
  /** The card's page at the seller, whose address often names the day. */
  page?: string | null;
  /** The card's own words. */
  name: string;
}

/**
 * The day a card is for and where it was read: the answer's own field when it has one, else the card's words, else
 * the address of its page. Empty when the card names no day anywhere, as a hotel's card does: its days are the search's.
 */
export function cardDays(card: CardWhen, now = new Date()): { days: string[]; readFrom: "the answer's field" | "the card's words" | "the card's page address" | null } {
  const field = daysIn(card.field ?? "", now);
  if (field.length > 0) return { days: field.slice(0, 1), readFrom: "the answer's field" };
  const name = daysIn(card.name, now);
  // The first day a card's words name is the day it is for. A later one can be when it ends.
  if (name.length > 0) return { days: name.slice(0, 1), readFrom: "the card's words" };
  let path = "";
  try {
    const url = new URL(card.page ?? "");
    path = decodeURIComponent(`${url.pathname} ${url.hash}`);
  } catch {
    // A card with no page, or one whose address cannot be read, names no day there.
  }
  const page = daysIn(path, now);
  if (page.length > 0) return { days: page.slice(0, 1), readFrom: "the card's page address" };
  return { days: [], readFrom: null };
}
