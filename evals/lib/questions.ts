/**
 * The product's own choices, as values: how a choice's values and a product's name are read against the size and the
 * colour a shopper asked for, and which choices have placeholders for names nobody can answer.
 *
 * What a reply asks, and whether it asks about something the shopper already said, is read by a model
 * (lib/reply-reader.ts), never here. These rules only compare a value or a name the answer's fields carry with the size
 * or the colour a row asks for: "M" is a medium, "Jet Black" is black.
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

/** True for a name a store never gave a choice: none at all, or the placeholder a page reader puts in its place. */
const placeholderName = (name: string) => /^(option|choice|select|default title|title)?\s*\d*$/i.test(name.trim());

/**
 * What is wrong with the names of the choices an answer asks for, one line, or none: several choices with a placeholder
 * for a name ("Option 4", "Option 11"), which is what the colours of a page's other products look like when they are
 * read as this product's options (2026-11-26). Nobody can answer them. Read from the answer's choice field.
 */
export function placeholderNames(groups: readonly Group[]): string[] {
  const named = (group: Group) => `"${group.name || "(no name)"}" (${group.options.map(valueOf).slice(0, 6).join(", ")})`;
  const unnamed = groups.filter((group) => placeholderName(group.name));
  return unnamed.length > 1 || (unnamed.length === 1 && groups.length > 1) ? [`${unnamed.length} of the choices have a placeholder for a name, so nobody can tell what they choose: ${unnamed.slice(0, 4).map(named).join("; ")}`] : [];
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

