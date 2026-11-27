/**
 * The questions a purchase asks the shopper, judged by the product and by what the shopper already said.
 *
 * Three rules, the same at every store:
 * - A question about a choice the product really has, such as a size or a colour, is fair, and a clarifying question is
 *   never a failure.
 * - A question about something the shopper already said is a failure: "Which size?" to a shopper who asked for a medium.
 * - A question nobody could answer is a failure: several choices with a placeholder for a name ("Option 4", "Option 11"),
 *   which is what the colours of a page's other products look like when they are read as this product's options
 *   (2026-11-26).
 *
 * Everything here is a fixed rule over the answer's `choice` field, with the reply's own words read only when the answer
 * carries no such field.
 */

/** One choice an answer asks the shopper to make: its name and its values, as the store lists them. */
export interface Group {
  name: string;
  required: boolean;
  options: string[];
}

/** Lower case, with every run of anything but letters and digits as one space. */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A value as the store lists it, without the extra price some stores add: `Gluten-free bread (+$2.46)`. */
export const valueOf = (option: string) => option.replace(/\s*\(\+[^)]*\)\s*$/, "").trim();

/** The sizes a shopper names in words, each with the letters a store lists it under. */
const SIZES: [RegExp, string][] = [
  [/\b(xxs|extra extra small)\b/, "xxs"],
  [/\b(xs|extra small|x small)\b/, "xs"],
  [/\b(size s|small)\b/, "s"],
  [/\b(size m|medium|med)\b/, "m"],
  [/\b(size l|large)\b/, "l"],
  [/\b(xl|extra large|x large)\b/, "xl"],
  [/\b(xxl|2xl|extra extra large)\b/, "xxl"],
];

/** The letter sizes the shopper's words name: "size medium" and "a medium" are `m`. */
function sizesSaid(said: string): Set<string> {
  // "extra large" names XL alone, never L as well.
  let rest = ` ${plain(said)} `;
  const sizes = new Set<string>();
  for (const [words, letters] of [...SIZES].sort((a, b) => b[1].length - a[1].length)) {
    if (words.test(rest)) {
      sizes.add(letters);
      rest = rest.replace(new RegExp(words.source, "g"), " ");
    }
  }
  return sizes;
}

/** A store's value for a letter size, as its letters: `M`, `Medium` and `MEDIUM (M)` are `m`. Null for any other value. */
function letterSize(option: string): string | null {
  const text = plain(valueOf(option));
  if (/^(xxs|xs|s|m|l|xl|xxl|2xl)$/.test(text)) return text === "2xl" ? "xxl" : text;
  for (const [words, letters] of SIZES) if (new RegExp(`^(${words.source.replace(/\\b/g, "")})( ${letters})?$`).test(text)) return letters;
  return null;
}

/**
 * True when the shopper already named this value: a letter size they named in words ("medium" for `M`), a number they
 * called a size ("size 10"), or any other value whose every word they typed in a row ("white", "6 ft"). A single letter
 * is matched as a size alone, so the "s" of "men's" never reads as a small.
 */
export function saidValue(option: string, said: string): boolean {
  // A message that is the value alone, or a list of values with it, is the shopper's answer to this very question.
  if (said.split("\n").some((message) => message.split(/,\s*/).some((part) => plain(part) !== "" && plain(part) === plain(valueOf(option))))) return true;
  const size = letterSize(option);
  if (size) return sizesSaid(said).has(size);
  const value = plain(valueOf(option));
  if (value.length === 0) return false;
  // A bare number is a size only when the shopper called it one: the "1" of a street address is not a quantity they chose.
  if (/^\d+(\s\d+)?$/.test(value)) return new RegExp(`\\bsize\\s+${valueOf(option).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\.?\\d)`, "i").test(said);
  return ` ${plain(said)} `.includes(` ${value} `);
}

/**
 * The value a shopper who said these words takes from a choice: the one they already named, else the first the store
 * lists. A shopper who asked for a medium answers "M" to "Which size?", and takes the first value of a choice they said
 * nothing about, such as a taco's filling.
 */
export function pickValue(group: Group, said: string, tried: ReadonlySet<string> = new Set()): string | undefined {
  const values = group.options.map(valueOf).filter(Boolean);
  return values.find((value) => saidValue(value, said)) ?? values.find((value) => !tried.has(value)) ?? values[0];
}

/** True for a name a store never gave a choice: none at all, or the placeholder a page reader puts in its place. */
const placeholderName = (name: string) => /^(option|choice|select|default title|title)?\s*\d*$/i.test(name.trim());

/**
 * What is wrong with the choices an answer asks for, one line each, or none when every question is fair.
 * `said` is everything the shopper typed before this answer.
 */
export function unfairQuestions(groups: readonly Group[], said: string): string[] {
  const unfair: string[] = [];
  const named = (group: Group) => `"${group.name || "(no name)"}" (${group.options.map(valueOf).slice(0, 6).join(", ")})`;
  const unnamed = groups.filter((group) => placeholderName(group.name));
  if (unnamed.length > 1 || (unnamed.length === 1 && groups.length > 1)) unfair.push(`${unnamed.length} of the choices have a placeholder for a name, so nobody can tell what they choose: ${unnamed.slice(0, 4).map(named).join("; ")}`);
  for (const group of groups) {
    const already = group.options.map(valueOf).filter((value) => saidValue(value, said));
    // One value the shopper named settles the choice. Two would mean their words fit more than one, and asking is fair.
    if (already.length === 1) unfair.push(`it asks ${named(group)} though the shopper already said "${already[0]}"`);
  }
  return unfair;
}

/**
 * The choice a reply writes on one line when the answer carries no `choice` field: "Which size? Size: XS, S, M, L".
 * Null when the reply writes none.
 */
export function inlineChoice(reply: string): Group | null {
  const found = reply.match(/\?\s*([A-Za-z ]{2,20}):\s*([^.\n]+,[^.\n]+)/);
  if (!found) return null;
  const options = found[2]!.split(/,\s*/).map((value) => value.trim()).filter(Boolean);
  return options.length > 1 ? { name: found[1]!.trim(), required: true, options } : null;
}

const ADD_AGAIN = /(want|would you like) me to (add|put)|(should|shall) i add|do you want (me to add|it from)|reply (with a )?yes|say yes and i'll (add|try)/i;

/** A question that asks the shopper to choose among a product's values: "Which size should I add?", "What colour do you want?". */
const WHICH = /\b(which|what)\s+(size|colou?r|length|width|style|fit|flavou?r|scent|finish|material|pack|one|option|variant|version|model|capacity|quantity)\b|\bhow many\b/i;

/**
 * True when a reply asks a shopper, who already said what they want, whether to add it: "Want me to add that one?",
 * "Should I add it?". A question about a choice the product has is never this, whatever its words: "Which size should I
 * add for the Jade Harmony Yoga Mat?" asks for a size the shopper has not given (2026-11-26, counted as asking twice).
 */
export function asksWhetherToAdd(reply: string, groups: readonly Group[] = []): boolean {
  if (groups.length > 0) return false;
  return reply
    .split(/(?<=[.?!])\s+|\n+/)
    .some((sentence) => ADD_AGAIN.test(sentence) && !WHICH.test(sentence));
}

/** The colours a product's name can state. A card that names one of these and not the colour asked for is another colour. */
const COLORS = ["black", "white", "gray", "grey", "navy", "blue", "red", "green", "yellow", "pink", "purple", "orange", "brown", "beige", "tan", "cream", "ivory", "khaki", "olive", "charcoal", "burgundy", "maroon", "teal", "gold", "silver"];

const colorWord = (color: string) => new RegExp(`\\b${color.toLowerCase().replace(/gr[ae]y/, "gr[ae]y")}\\b`, "i");

/** True when a text shows the colour the shopper asked for: "Black", "Jet Black", "Color: black". */
export function showsColor(text: string, color: string): boolean {
  return colorWord(color).test(text);
}

/**
 * True when a product's name states a colour and none of them is the one asked for: a "White T-Shirt" for a shopper who
 * asked for black. A name that states no colour at all is not another colour: the colour is then a choice on its page.
 */
export function namesAnotherColor(name: string, color: string): boolean {
  if (showsColor(name, color)) return false;
  return COLORS.some((other) => colorWord(other).test(name));
}

/** The letter sizes a text states as words of their own: `m` for "Black M" and for "Size: Medium". The "s" of "Men's" is not one. */
function sizesShown(text: string): Set<string> {
  const shown = new Set<string>();
  for (const word of text.replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}.]+/u)) {
    const letters = letterSize(word);
    if (letters) shown.add(letters);
  }
  return shown;
}

/**
 * True when a product's name states a size and none of them is the one asked for: "Black XL" for a shopper who asked
 * for a medium. A name that states no size is not another size: the size is then a choice on its page. Only sizes named
 * in letters or words are read; a number in a name can be a pack's count as easily as a size.
 */
export function namesAnotherSize(name: string, size: string): boolean {
  const asked = sizesSaid(size);
  if (asked.size === 0) return false;
  const shown = sizesShown(name);
  return shown.size > 0 && ![...shown].some((one) => asked.has(one));
}

/**
 * True when a text shows the size the shopper asked for. A size named in words is shown by its letters or its word
 * ("M", "Medium", "Size: M"), and a number by that number standing alone ("10", never the 10 of "10.5" or "$10").
 */
export function showsSize(text: string, size: string): boolean {
  const named = sizesSaid(size);
  if (named.size > 0) {
    return [...sizesShown(text)].some((letters) => named.has(letters));
  }
  const value = size.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.$])${value}(?![\\d]|\\.\\d)`, "i").test(text);
}

/** Words that say a product cannot be had as named: sold out, out of stock, not offered or not sold in it. */
const NOT_OFFERED = /\b(sold out|out of stock|unavailable|not available|isn't available|is not available|aren't available|not offered|isn't offered|not sold|isn't sold|doesn't come|does not come|don't come|isn't made|not made)\b/i;

/** The parts of a reply that say one thing each: its sentences, and the two sides of a "but" or a semicolon. */
const clauses = (reply: string) => reply.split(/(?<=[.?!])\s+|\n+|;|\bbut\b|,\s*(?:though|while|whereas)\b/i);

/**
 * The colour or the size the shopper asked for, when a reply says the product is not offered in it, else null: "M is
 * sold out" to a shopper who asked for a medium, "It doesn't come in black". Only the part of a sentence that says what
 * is not offered is read, so "S is sold out, but M is in stock" says nothing against a medium.
 */
export function askedNotOffered(reply: string, asked: { color?: string; size?: string }): string | null {
  for (const part of clauses(reply)) {
    if (!NOT_OFFERED.test(part)) continue;
    if (asked.size && showsSize(part, asked.size)) return asked.size;
    if (asked.color && showsColor(part, asked.color)) return asked.color;
  }
  return null;
}

/**
 * True when a reply goes back to the shopper because something they asked for is not offered, and asks what they want
 * instead: "This shirt comes in black in S, L and XL. M is sold out. Which one, or should I look for another shirt?".
 * Agentcard read those options off the product's own page, so asking about a size or a colour again here is fair: the
 * answer the shopper gave cannot be had.
 */
export function offersThePagesOptions(reply: string): boolean {
  return reply.includes("?") && clauses(reply).some((part) => NOT_OFFERED.test(part));
}
