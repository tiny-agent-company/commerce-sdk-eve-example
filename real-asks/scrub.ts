/**
 * Takes personal details out of a shopper's message with fixed patterns: links, email addresses, phone numbers, card
 * numbers and other long numbers, order and account ids, and street addresses. A model then removes what a pattern
 * cannot know, such as a person's name (prepare.ts), and these patterns run once more over what the model returns, so
 * nothing they catch can come back.
 *
 * A city, a state, a country and a postcode stay: they say where to deliver, not who the shopper is.
 */

const STREET = "street|avenue|road|boulevard|drive|lane|court|place|terrace|parkway|highway|circle|square|calle|avenida|rua|strasse|straße|rue|straat|laan";
const STREET_SHORT = "st|ave|rd|blvd|dr|ln|ct|pl|pkwy|hwy|cir|sq";
const UNIT = "(?:,?\\s*(?:apt|apartment|unit|suite|ste|floor|fl|#)\\.?\\s*[\\w-]+)?";

const PATTERNS: [RegExp, string][] = [
  // Links, with or without the scheme. A bare store name such as nike.com stays: it names a store, not a person.
  [/\bhttps?:\/\/[^\s<>"')\]]+/gi, "[link]"],
  [/\bwww\.[^\s<>"')\]]+/gi, "[link]"],
  [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\/[^\s<>"')\]]+/gi, "[link]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // Ids the backend or a store hands out: prefixed ids, UUIDs and long mixed codes after "order", "tracking" and the like.
  [/\b(?:usr|org|ord|conv|cart|pay|card|cus|pi|ch|sub)_[A-Za-z0-9]{6,}\b/g, "[id]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\b((?:order|pedido|bestellung|commande|confirmation|tracking|reference|booking|reservation|ticket|invoice|account|member(?:ship)?)\s*(?:id|number|no\.?|code|#)?\s*(?:is\s*)?[:#]?\s*)(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}\b/gi, "$1[order id]"],
  // Card numbers and any other run of nine or more digits, however it is spaced. Prices, sizes and model numbers are shorter.
  [/(?<![\w.])(?:\+?\d[\s().-]{0,3}){8,}\d(?![\w])/g, "[number]"],
  // A street address: a house number, up to four words and a street word. The short forms count only at the end of the address.
  [new RegExp(`\\b\\d{1,6}[a-z]?\\s+(?:[\\p{L}0-9.'-]+\\s+){0,4}(?:${STREET})\\b\\.?${UNIT}`, "giu"), "123 Main St"],
  [new RegExp(`\\b\\d{1,6}[a-z]?\\s+(?:[\\p{L}0-9.'-]+\\s+){1,4}(?:${STREET_SHORT})\\b\\.?${UNIT}(?=\\s*(?:[,.;\\n]|$))`, "giu"), "123 Main St"],
  // The same in the languages that put the street word first: "Calle Mayor 12", "Rua Augusta 1200", "Hauptstraße 5".
  [new RegExp(`\\b(?:calle|avenida|av\\.|rua|rue|via|carrer)\\s+(?:[\\p{L}.'-]+\\s+){1,4}\\d{1,5}[a-z]?\\b`, "giu"), "Calle Mayor 1"],
  [/\b[\p{L}-]+(?:straße|strasse|straat|laan|weg|gasse)\s+\d{1,5}[a-z]?\b/giu, "Hauptstraße 1"],
];

/** The words the patterns write in place of what they remove. */
export const STAND_INS = ["[link]", "[email]", "[id]", "[order id]", "[number]", "123 Main St", "Calle Mayor 1", "Hauptstraße 1"];

/** The message with every personal detail a pattern can catch replaced by a stand-in. */
export function scrub(text: string): string {
  let clean = text;
  for (const [pattern, stand] of PATTERNS) clean = clean.replace(pattern, stand);
  return clean.replace(/[ \t]{2,}/g, " ").trim();
}

/** True when the patterns would still change the text, which means a personal detail is left in it. */
export function stillHolds(text: string): boolean {
  return scrub(text) !== text.replace(/[ \t]{2,}/g, " ").trim();
}

/** The words of a message, lower case, without punctuation: how two messages are compared. */
export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

const FILLER = new Set("a an the i me my you your we us please pls can could would to for of and or in on at with from that this it is are be do need want some any find get buy order looking show search have has like just um de la el un una por para que y en con le les des du et pour je me quiero necesito um uma o os as e eu".split(" "));

/** The words that carry a message's meaning, as a set: its words without the small ones. */
export function meaning(text: string): Set<string> {
  return new Set(words(text).filter((word) => !FILLER.has(word)));
}

/** How alike two messages are, from 0 (no meaning word in common) to 1 (the same meaning words). */
export function alike(a: string, b: string): number {
  const [left, right] = [meaning(a), meaning(b)];
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}
