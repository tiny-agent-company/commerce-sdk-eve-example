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
  "as_listed",
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
  /** The contact details the reply asks for now, not those it only thanks the shopper for. */
  details: Detail[];
  /** Each detail the shopper gave that the reply says was not taken, and whether it says why. */
  refused: { detail: Detail; reasonGiven: boolean }[];
  /** The product's choices the reply lists in its own words, with the values it says cannot be had. Empty when it lists none. */
  choices: { name: string; values: string[]; unavailable: string[] }[];
  /**
   * For each choice the shopper is asked to make: the value that fits what they asked for. When they named nothing for it,
   * the first value that can be had. Null when they asked for something specific that is not among the values that can be had.
   */
  fits: { choice: string; value: string | null }[];
  /** Each question the reply asks about something the shopper's messages already settled. */
  alreadySaid: string[];
  /**
   * The products the reply asks the shopper to choose among, with the number it gives each, the store it names, and
   * whether it fits what the shopper asked for (false when the reply says it is not in the colour, size or other thing
   * they asked for).
   */
  products: { number: number | null; name: string; store: string | null; fitsTheAsk: boolean }[];
  /** The store the product the reply offers to add is sold at, as the reply says it, or null. */
  offerAt: string | null;
  /** What the reply says the store answered that only the store decides, or null: it is out of stock, it charges another price than the card showed, or a booking has nothing available. */
  storeSays: "out_of_stock" | "price_differs" | "no_availability" | null;
}

/** A contact detail a booking or a guest checkout asks for. */
export const DETAILS = ["name", "date_of_birth", "gender", "email", "phone"] as const;
export type Detail = (typeof DETAILS)[number];

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
  /** Everything the shopper typed so far, in order, the message this reply answers last. */
  shopper?: string[];
  /** The choices the answer's own `choice` field asks, when it has one: they come first. */
  choiceField?: { name: string; options: string[] }[];
}

export type Reader = (input: ReaderInput) => Promise<Reading>;

const Shape = z.object({
  asks: z.enum(ASKS).describe(
    [
      "The one thing the reply asks the shopper to answer now.",
      "pay_or_book: a yes that places, pays for or books this cart or booking, in any words ('Say yes to place the order', 'Say yes to buy it at that price', 'Confirm to pay', 'Should I book it?', 'Say yes only if you still want it at this price').",
      "confirm_address: only a question whether an address read back is right ('Is it 1 Ferry Plz…? Say yes, or send me the right address'). A reply that says where it ships and asks for the yes to place the order ('Got it, it ships to 1 Ferry Plz. Say yes to place the order.') is pay_or_book, never confirm_address.",
      "add_to_cart: a yes to put a product or a booking in the cart, with no cart to pay yet ('Want me to add it?', 'Do you want the King Room?').",
      "keep_waiting_or_another_store: a choice between waiting longer for a store's total and buying elsewhere.",
      "try_again: an offer to try the same checkout once more.",
      "as_listed: whether to keep the product already chosen exactly as the store lists it, or change its options. Never an offer of a product in another colour or size than asked, which is other_question.",
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
  details: z.array(z.enum(DETAILS)).describe("The contact details the reply's own words ask the shopper for now. Only those it names as needed: never one you think a checkout usually needs. A delivery or shipping address is never one of these (that is asks = address), and \"email\" is only an email address. Not a detail it only says it has or thanks them for ('I have your name. What's the address?' asks for none)."),
  refused: z.array(z.object({ detail: z.enum(DETAILS), reason_given: z.boolean().describe("True when the reply says why it was not taken, such as a test email, a fictional 555 number, or a supplier refusing it.") })).describe("Each detail the shopper already gave that the reply says was not taken or asks for again."),
  choices: z.array(z.object({ name: z.string(), values: z.array(z.string()), unavailable: z.array(z.string()).describe("Values the reply says are sold out, out of stock or not offered.") })).describe("The product's own choices (size, colour, fit, flavour…) the reply lists in its words, each with its values as written. Empty when it lists none."),
  fits: z.array(z.object({ choice: z.string(), value: z.string().nullable() })).describe("For each choice the shopper is asked to make now (the answer's choice field when given, else the choices listed in the reply): the value that can be had that matches what the shopper's messages asked for, written as the store writes it ('Jet Black' for black, 'M' for medium). When the shopper named nothing for that choice, the first value that can be had. null only when the shopper asked for something specific for that choice and no value that can be had matches it."),
  already_said: z
    .array(
      z.object({
        question: z.string().describe("The question, copied as the reply asks it, ending with its question mark."),
        value_given: z.string().describe("The value the shopper's messages already gave for it."),
        kind: z.enum(["asks_for_the_value", "asks_to_confirm"]).describe("asks_for_the_value: it asks the shopper to say the value (which size, how many). asks_to_confirm: it states the value and asks for a yes or no ('Do you want it at 7:00 PM?')."),
      }),
    )
    .describe("Each question that asks the shopper to choose or give a value their messages already gave, such as a size they named or how many tickets they asked for. Leave out every sentence that is not a question, every question that asks the shopper to confirm a choice they made, and every question about something they asked for that the reply says cannot be had."),
  products: z
    .array(z.object({ number: z.number().int().nullable(), name: z.string(), store: z.string().nullable(), fits_the_ask: z.boolean().describe("False when the reply says this product is not in the colour, size or other thing the shopper's messages asked for, or offers it in another one.") }))
    .describe("The products the reply asks the shopper to choose among, in its order, with the number it gives each and the store it says each is at."),
  offer_at: z.string().nullable().describe("When the reply offers to add a product, the store it says that product is at, else null."),
  store_says: z.enum(["out_of_stock", "price_differs", "no_availability", "none"]).describe("What the reply says the store itself answered: out_of_stock when the product is sold out or no longer in stock; price_differs when the store charges another price than the card showed, with that price; no_availability when a booking has no seats, rooms, tables, tickets or times in the dates asked, or nothing to book. none otherwise, including a store that could not be reached or a checkout that failed."),
});

const RULES = [
  "You read one reply of a shopping assistant, Agentcard, to a shopper, together with the cart it shows. You report what the reply asks the shopper and whether its amounts agree with the cart.",
  "Read the reply for what it means, in whatever words it uses. Never assume a word means something on its own: 'yes' appears in many asks.",
  "The cart's fields are the truth about prices. A line whose price_in_total is true is priced only inside the cart's total.",
  "Amounts in cents may be rounded to the nearest cent. A reply may give a total and then explain how it adds up: judge the explanation against the fields.",
  "An amount equal to the cart's total is right whatever the reply calls it: the total, the store's total, what it comes to.",
  "A new price the reply says the store now charges for a line is wrong when the cart's line still carries another price and the cart has no price_change: the shopper would say yes to a cart that does not carry what they were told.",
  "A store that has not sent its total yet is still_pricing, however long it has taken. could_not_price is only a store that gave up, refused, or will not send a total.",
  "What a reply asks is only what it asks or requests in its own words. Never infer an offer it does not make: a reply that says a checkout failed and asks nothing asks nothing.",
  "A reply that states where the order ships and asks for the yes to place or pay asks pay_or_book. confirm_address is only a question whether an address is right.",
  "Read the shopper's messages as a person would: 'a black tee in size medium' named a colour and a size; a value they chose earlier in the chat for the same product still stands.",
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
    prompt: [
      `What the shopper typed so far, in order:\n${(input.shopper ?? []).map((message, index) => `${index + 1}. ${short(message)}`).join("\n") || "(nothing)"}`,
      `Agentcard's reply to the last of those:\n${input.reply.trim() || "(empty)"}`,
      `The choices the answer's own field asks: ${input.choiceField?.length ? input.choiceField.map((group) => `${group.name}: ${group.options.join(", ")}`).join("; ") : "none"}`,
      `The cart this answer shows:\n${cart}`,
      `The answer's next step field: ${input.nextAction ?? "none"}`,
      `Amounts the chat showed before (earlier totals, the picked card's price): ${input.earlier.join(", ") || "none"}`,
    ].join("\n\n"),
  });
  return {
    asks: output.asks,
    pricing: output.pricing === "none" ? null : output.pricing,
    stillWorking: output.still_working,
    quotesTheCharge: output.quotes_the_charge,
    wrongAmounts: input.cart ? output.wrong_amounts : [],
    details: output.details,
    refused: output.refused.map((one) => ({ detail: one.detail, reasonGiven: one.reason_given })),
    choices: output.choices,
    fits: output.fits,
    alreadySaid: output.already_said.filter((one) => one.kind === "asks_for_the_value" && one.question.trim().endsWith("?")).map((one) => `${one.question} (the shopper already gave ${one.value_given})`),
    products: output.products.map((product) => ({ number: product.number, name: product.name, store: product.store, fitsTheAsk: product.fits_the_ask })),
    offerAt: output.offer_at,
    storeSays: output.store_says === "none" ? null : output.store_says,
  };
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

/**
 * Which of these replies say a thing, described in plain words ("asks the shopper whether to add the product they already
 * named"), by their index. Read by the same model as every reply, never by matching words: on 2026-11-26 "Which size
 * should I add?" was read by words as asking whether to add. Throws when the model cannot be reached twice.
 */
export async function findSaying(replies: readonly string[], what: string): Promise<number[]> {
  if (replies.length === 0) return [];
  const ask = async () => {
    const { output } = await generateText({
      model: anthropic("claude-sonnet-5"),
      output: Output.object({ schema: z.object({ saying: z.array(z.number().int()).describe("The numbers of the replies that say it. Empty when none does.") }) }),
      system: "You read replies of a shopping assistant to a shopper. You say which replies say a given thing, by meaning, in any words. A reply that only mentions a topic does not say the thing; a question about a choice the product has is not a question about whether to add it.",
      prompt: `The thing: a reply that ${what}\n\nThe replies:\n${replies.map((reply, index) => `${index + 1}. ${short(reply).slice(0, 1500)}`).join("\n")}`,
    });
    return output.saying.map((number) => number - 1).filter((index) => index >= 0 && index < replies.length);
  };
  return ask().catch(() => ask());
}
