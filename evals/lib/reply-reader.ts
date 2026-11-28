import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";

/**
 * Reads one of Agentcard's replies the way a person would: what it asks the shopper, whether the store is still pricing,
 * and whether every amount it quotes agrees with the cart it shows. A model reads it, never a list of words: the same
 * ask can be worded a hundred ways ("Say yes to place the order", "Say yes to buy it at that price", "Confirm to pay"),
 * and an amount can be true without being one of the cart's fields (shipping and tax named apart, the gap between the
 * card's price and the store's, a rental deposit, the most the card is held for).
 *
 * The evals' shopper decides what to say from this reading, and the checks grade the reply by it. The answer's fields
 * come first wherever there is one: `next_action: confirm` is the yes whatever the words, and `cart.pricing` is a store
 * still pricing. The reading is what is left to read in the words.
 *
 * Runs on the example app's own model, once per reply, with the same Anthropic key. Its rules are checked by
 * evals/judge/reply-reader.eval.ts, which feeds it replies from real runs whose reading is known.
 */

/** What a reply asks the shopper to answer, the one thing that decides what they say next. */
export const ASKS = [
  "pay_or_book",
  "confirm_address",
  "add_to_cart",
  "keep_waiting_or_another_store",
  "try_again",
  "product_option",
  "address",
  "contact_details",
  "how_many",
  "other_question",
  "nothing",
] as const;
export type Ask = (typeof ASKS)[number];

export interface Reading {
  asks: Ask;
  /** `still_pricing`: the store is still working out the price or total. `could_not_price`: it gave up without a total. */
  pricing: "still_pricing" | "could_not_price" | null;
  /** True when the reply only says Agentcard is still working on the last message, and asks nothing. */
  stillWorking: boolean;
  /** True when the reply names the amount a yes would be for: the cart's total, or the estimate with the most the card is held for. */
  quotesTheCharge: boolean;
  /** Each amount the reply presents as a price, total, estimate or charge of this cart that the cart's fields contradict. */
  wrongAmounts: { amount: string; why: string }[];
}

/** The cart's fields the reader is shown, as the model reads them. */
export interface CartFields {
  store: string;
  items: { name: string; qty: number; price: string | null; line_total: string | null; price_in_total?: true; options?: string[]; variant?: string | null }[];
  fees: string | null;
  total: string;
  total_is_estimate: boolean;
  pricing?: true;
  store_total?: string;
  max_charge?: string | null;
  breakdown?: { subtotal: string; shipping: string | null; tax: string | null; discount: string | null };
  price_change?: { card_price: string; store_price: string | null };
}

export interface ReaderInput {
  reply: string;
  /** The cart this answer shows, or null. */
  cart: CartFields | null;
  /** The answer's `next_action`, for context only. */
  nextAction: string | null;
  /** Totals the chat showed before this answer, and the picked card's price: amounts a reply may compare against. */
  earlier: string[];
}

export type Reader = (input: ReaderInput) => Promise<Reading>;

const Shape = z.object({
  asks: z.enum(ASKS).describe(
    [
      "The one thing the reply asks the shopper to answer now.",
      "pay_or_book: a yes that places, pays for or books this cart or booking, in any words ('Say yes to place the order', 'Say yes to buy it at that price', 'Confirm to pay', 'Should I book it?', 'Say yes only if you still want it at this price').",
      "confirm_address: a yes to an address read back ('Is it 1 Ferry Plz…? Say yes, or send me the right address').",
      "add_to_cart: a yes to put a product or a booking in the cart, with no cart to pay yet ('Want me to add it?', 'Do you want the King Room?').",
      "keep_waiting_or_another_store: a choice between waiting longer for a store's total and buying elsewhere.",
      "try_again: an offer to try the same checkout once more.",
      "product_option: a choice the product itself has, such as its size, colour, fit, flavour or pack size, including 'which one of these' among a product's options.",
      "address: where to deliver. contact_details: a name, email or phone number. how_many: a quantity or number of guests.",
      "other_question: any other question, such as which of several products. nothing: it asks nothing.",
    ].join(" "),
  ),
  pricing: z.enum(["still_pricing", "could_not_price", "none"]).describe("still_pricing when the reply says the store is still working out the price or total; could_not_price when it says the store gave up or never sent a total; none otherwise."),
  still_working: z.boolean().describe("True only when the reply says Agentcard is still working on the shopper's last message and will answer later, and asks nothing."),
  quotes_the_charge: z.boolean().describe("True when the reply names the amount a yes would be for: the cart's total, or its estimate together with the most the card is held for. False when it names no amount, or only other amounts."),
  wrong_amounts: z
    .array(z.object({ amount: z.string(), why: z.string().describe("One sentence: which field of the cart it contradicts.") }))
    .describe(
      "Each amount the reply presents as a price, total, estimate or charge of THIS cart or one of its lines that the cart's fields contradict. Empty when there is no cart. NOT wrong: an amount equal to a field; parts that add up to the total, such as shipping and tax named apart; one unit's or one night's share; the difference between two amounts the chat showed, such as the card's price and the store's, or an old and a new total; the most the card is held for; a deposit or hold the reply explains as such; an amount from an earlier total the reply says changed; an amount about another product. Wrong: an estimate or total that matches no field and no true sum of fields, or a line price the cart's line does not carry.",
    ),
});

const RULES = [
  "You read one reply of a shopping assistant, Agentcard, to a shopper, together with the cart it shows. You report what the reply asks the shopper and whether its amounts agree with the cart.",
  "Read the reply for what it means, in whatever words it uses. Never assume a word means something on its own: 'yes' appears in many asks.",
  "The cart's fields are the truth about prices. A line whose price_in_total is true is priced only inside the cart's total.",
  "Amounts in cents may be rounded to the nearest cent. A reply may give a total and then explain how it adds up: judge the explanation against the fields.",
  "An amount equal to the cart's total is right whatever the reply calls it: the total, the store's total, what it comes to.",
  "A new price the reply says the store now charges for a line is wrong when the cart's line still carries another price and the cart has no price_change: the shopper would say yes to a cart that does not carry what they were told.",
  "A store that has not sent its total yet is still_pricing, however long it has taken. could_not_price is only a store that gave up, refused, or will not send a total.",
].join("\n");

const short = (text: string) => text.replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").trim();

/** The default reader: the app's own model, once per distinct reply and cart. */
export const modelReader: Reader = async (input) => {
  const cart = input.cart
    ? JSON.stringify({
        store: input.cart.store,
        lines: input.cart.items.map((item) => ({ name: item.name, qty: item.qty, price: item.price, line_total: item.line_total, ...(item.price_in_total ? { price_in_total: true } : {}) })),
        fees: input.cart.fees,
        total: input.cart.total,
        total_is_estimate: input.cart.total_is_estimate,
        still_pricing: input.cart.pricing === true,
        store_total: input.cart.store_total ?? null,
        most_the_card_is_held_for: input.cart.max_charge ?? null,
        store_summary: input.cart.breakdown ?? null,
        price_change: input.cart.price_change ?? null,
      })
    : "(no cart)";
  const { output } = await generateText({
    model: anthropic("claude-sonnet-5"),
    output: Output.object({ schema: Shape }),
    system: RULES,
    prompt: [`Agentcard's reply:\n${short(input.reply) || "(empty)"}`, `The cart this answer shows:\n${cart}`, `The answer's next step field: ${input.nextAction ?? "none"}`, `Amounts the chat showed before (earlier totals, the picked card's price): ${input.earlier.join(", ") || "none"}`].join("\n\n"),
  });
  return { asks: output.asks, pricing: output.pricing === "none" ? null : output.pricing, stillWorking: output.still_working, quotesTheCharge: output.quotes_the_charge, wrongAmounts: input.cart ? output.wrong_amounts : [] };
};

let reader: Reader = modelReader;
const cache = new Map<string, Promise<Reading>>();

/** Replaces the reader, for tests. Returns the one it replaced. */
export function useReader(next: Reader): Reader {
  const before = reader;
  reader = next;
  cache.clear();
  return before;
}

/**
 * Reads one reply, once: the same reply over the same cart is read once per run. A reader that fails twice gives null,
 * and the evals then go by the answer's fields alone; `note` hears why.
 */
export async function readReply(input: ReaderInput, note: (line: string) => void = () => {}): Promise<Reading | null> {
  const key = JSON.stringify(input);
  let reading = cache.get(key);
  if (!reading) {
    const attempt = () => reader(input);
    reading = attempt().catch(() => attempt());
    cache.set(key, reading);
  }
  try {
    return await reading;
  } catch (error) {
    cache.delete(key);
    note(`the reply could not be read (${error instanceof Error ? error.message.slice(0, 160) : String(error)}), so this answer is read from its fields alone`);
    return null;
  }
}
