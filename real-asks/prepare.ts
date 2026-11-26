import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";
import type { Want } from "../evals/lib/judge.ts";
import { scrub, STAND_INS, stillHolds, words } from "./scrub.ts";

/** The kinds of thing a shopper asks for, so a day can be summed up without quoting anybody. */
export const KINDS = ["retail", "groceries", "restaurant food", "flights", "hotels", "other travel", "gift cards", "services", "other"] as const;

/** Why a message cannot be kept as an eval. */
export const NOT_USABLE = [
  "confirms, picks or answers instead of asking",
  "not a shopping ask",
  "needs a link, a picture or an attachment",
  "needs the shopper's account, order or saved details",
  "a test or nonsense",
  "cannot be understood without personal details",
] as const;

const Prepared = z.object({
  usable: z.boolean().describe("True when the last message is a shopping ask that can be sent again, as it stands, to a shopping assistant that has never seen this shopper."),
  why_not: z.enum(NOT_USABLE).nullable().describe("When not usable, the one reason that fits best. Null when usable."),
  needs_earlier: z.boolean().describe("True when the last message only makes sense together with the earlier ones."),
  messages: z.array(z.string()).describe("The messages to send, in order, with personal details replaced: the earlier ones only when needs_earlier is true, then the last message. Every other word exactly as typed."),
  kind: z.enum(KINDS),
  wants: z.array(z.object({ what: z.string().describe("The thing, in a few words."), must: z.array(z.string()).describe("Each requirement the shopper's words put on it, one fact each.") })),
  may_ask: z.boolean().describe("True when a question back to the shopper is a right first answer: food or groceries that need a delivery address, travel that needs dates, an ask too vague to search."),
  priced: z.boolean().describe("False only for things whose cards carry no price, such as a restaurant table or a free event."),
  right_answer: z.string().describe("Empty in most cases. One sentence on what a right answer looks like when it is not simply showing the thing: the reply must be in the shopper's language, or the store named cannot be bought from and the reply must say so."),
});

const RULES = [
  "You turn one real message a shopper sent to a shopping assistant into a test case. You do three things: decide whether it can be a test case, remove personal details from it, and write down what the shopper asked for.",
  "",
  "1. Usable or not. A usable message asks to find or buy something and can be sent again to an assistant that has never seen this shopper. Not usable: a yes, a no, a confirmation of a cart, a pick from a list that was shown, an answer to the assistant's question, a greeting, a question about an order already placed, anything that depends on the shopper's account or on a link, and test text.",
  "",
  "2. Personal details. Some were already replaced by stand-ins in square brackets, or by `123 Main St`; leave those as they are. Replace what is left: a person's name becomes `Alex` (a second person `Sam`), a street address becomes `123 Main St`, a username, a date of birth, a door code or a loyalty number becomes `[removed]`. Keep the city, the state, the country and the postcode. Keep brand names, store names, product names and the names of public places such as a hotel, a restaurant or an airport. Change nothing else: keep every other word, the spelling mistakes, the language, the punctuation and the line breaks exactly as typed. If the message cannot be understood once the details are gone, it is not usable.",
  "",
  "3. What the shopper asked for. List each thing as `what` with its `must` requirements, one fact per requirement, each a fact a product card (a name, a store and a price) could show or contradict. Take requirements only from the shopper's words: the kind of product, the brand and model, the size, the colour, the material, what it must fit, what to leave out, the store, the price limit. Do not add requirements the shopper did not state, and do not turn taste words such as `nice` or `decent` into requirements. A price limit reads `costs under $30`. A named store reads `sold by Walmart`. A quantity is not a requirement, since the shopper can buy more than one.",
  "Examples of `wants`:",
  "- `a screen protector for an iPhone 16` → [{ what: `screen protector`, must: [`a screen protector`, `made for the iPhone 16, not only the Plus, Pro, Pro Max or another model`] }]",
  "- `a laptop backpack, not leather, no pink` → [{ what: `laptop backpack`, must: [`a backpack that holds a laptop`, `not leather`, `not pink`] }]",
  "- `a yoga mat under $30` → [{ what: `yoga mat`, must: [`a yoga or exercise mat`, `costs under $30`] }]",
  "- `order me a chicken burrito for lunch` → [{ what: `chicken burrito`, must: [`a burrito`, `with chicken`] }], may_ask true",
  "For a flight, a hotel or another booking, the requirements are the facts of the trip: the route or the place, the dates, the cabin or the room, nonstop when asked.",
  "When the message is not usable, still fill every field: `messages` with the cleaned text and `wants` with an empty list.",
].join("\n");

export interface Case {
  usable: boolean;
  whyNot: string | null;
  messages: string[];
  kind: string;
  wants: Want[];
  mayAsk: boolean;
  priced: boolean;
  context: string;
}

const NOT = (why: (typeof NOT_USABLE)[number]): Case => ({ usable: false, whyNot: why, messages: [], kind: "other", wants: [], mayAsk: false, priced: true, context: "" });

/** The share of a cleaned message's words that were not in the message as typed, stand-ins aside: above a little, the model rewrote it. */
function newWords(cleaned: string, typed: string): number {
  const known = new Set([...words(typed), ...words(STAND_INS.join(" ")), "alex", "sam", "removed"]);
  const said = words(cleaned);
  return said.length === 0 ? 1 : said.filter((word) => !known.has(word)).length / said.length;
}

/**
 * Turns one shopper message, with the earlier messages of its chat, into a test case: cleaned of personal details, with
 * its requirements drafted. The fixed patterns run before the model reads anything and again over what it returns.
 * A case the model rewrote instead of cleaning, or that still holds a detail a pattern catches, is refused.
 */
export async function prepare(ask: string, earlier: string[]): Promise<Case> {
  const [typed, before] = [scrub(ask), earlier.slice(-4).map(scrub)];
  const { output } = await generateText({
    model: anthropic("claude-opus-5-5"),
    output: Output.object({ schema: Prepared }),
    system: RULES,
    prompt: [`Earlier messages from the same shopper in this chat, oldest first:\n${before.map((message, index) => `${index + 1}. ${message}`).join("\n") || "(none)"}`, `The last message, which is the one to turn into a test case:\n${typed}`].join("\n\n"),
  });
  if (!output.usable) return { ...NOT(output.why_not ?? "not a shopping ask"), kind: output.kind };
  // A link the ask can do without is dropped; an ask that needs its link was already refused by the model.
  const messages = output.messages.map((message) => scrub(message).replace(/\s*\[link\]/g, "").replace(/\s*\(\s*\)/g, "").trim()).filter((message) => message.length > 0);
  const wants = output.wants.filter((want) => want.what.trim()).map((want) => ({ what: scrub(want.what), must: want.must.map(scrub) }));
  if (messages.length === 0 || wants.length === 0) return NOT("not a shopping ask");
  if (messages.some(stillHolds) || newWords(messages.join(" "), [typed, ...before].join(" ")) > 0.1) return NOT("cannot be understood without personal details");
  if (messages.some((message) => /\[(id|order id)\]/.test(message))) return { ...NOT("needs the shopper's account, order or saved details"), kind: output.kind };
  return { usable: true, whyNot: null, messages, kind: output.kind, wants, mayAsk: output.may_ask, priced: output.priced, context: scrub(output.right_answer) };
}
