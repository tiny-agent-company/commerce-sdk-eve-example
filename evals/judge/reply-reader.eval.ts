import { defineEval } from "eve/evals";
import { modelReader, type Ask, type CartFields, type Reading } from "../lib/reply-reader.ts";

/**
 * Checks the reply reader itself (lib/reply-reader.ts). Each case hands it a reply Agentcard really gave in an eval
 * shopper's chat (2026-11-27 and 28), with the cart it showed, and fails when the reader gets wrong what the reply asks,
 * whether the store is still pricing, whether it names the amount a yes is for, or whether an amount is wrong. No
 * shopper message is sent and the buy tool is not called.
 */
const line = (price: string, name = "the product") => ({ name, qty: 1, price, line_total: price });
const estimate = (total: string, price: string, max: string, fees: string): CartFields => ({ store: "the store", items: [line(price)], fees, total, total_is_estimate: true, max_charge: max });
const exact = (total: string, price: string, more: Partial<CartFields> = {}): CartFields => ({ store: "the store", items: [line(price)], fees: null, total, total_is_estimate: false, ...more });

interface Case {
  name: string;
  reply: string;
  cart: CartFields | null;
  earlier?: string[];
  asks: Ask;
  pricing?: Reading["pricing"];
  stillWorking?: boolean;
  quotesTheCharge?: boolean;
  wrong: boolean;
}

const cases: Case[] = [
  {
    name: "a wrong estimate over a cart is a wrong amount",
    reply: "Added the 6 ft High Speed HDMI Cable with Ethernet from Best Buy, about $24.84 estimated.\n\nWhat's the delivery address?",
    cart: estimate("$21.29", "$20.77", "$32.62", "$0.52"),
    asks: "address",
    wrong: true,
  },
  {
    name: "shipping and tax named apart are true parts of the total",
    reply: "Pentel WOW! Retractable Ballpoint Pens, Pack Of 12 (Dozen) at Staples: $21.63 with tax and shipping, read from the store's own checkout. Confirm to pay with your card. heads up: shipping is $12.95, so with $0.69 tax it comes to $21.63.",
    cart: exact("$21.63", "$7.99"),
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "a price change asked as 'say yes to buy it at that price' is the yes, and its parts are true",
    reply: "Stanley 16 oz Smooth Face Nailing Rip Claw Hammer at Ace Hardware: the card showed $26.99 and Ace Hardware charges $28.99 for it, so it comes to $41.65 with tax and shipping. Say yes to buy it at that price. heads up: shipping is $10.16, so with $2.50 tax it comes to $41.65.",
    cart: exact("$41.65", "$28.99", { price_change: { card_price: "$26.99", store_price: "$28.99" } }),
    earlier: ["$26.99"],
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "'say yes only if you still want it' at a new price is the yes",
    reply: "Men's Airism Crew Neck T-shirt (Color: WHITE, Size: M) at Uniqlo: heads up: the card showed $14.90, but Uniqlo charges $22.89 for it now for the option you picked, so it comes to $24.18 with tax and shipping. Say yes only if you still want it at this price.",
    cart: exact("$24.18", "$22.89", { price_change: { card_price: "$14.90", store_price: "$22.89" } }),
    earlier: ["$14.90"],
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "the difference from an earlier estimate is not a wrong amount",
    reply: "Macy's has priced it, and the total is higher than the estimate.\n\n- The peeler is $14.40 at the store, not the $18.00 shown earlier.\n- The store's total comes to $27.25 with tax, shipping and fees. Your card can be held for up to $29.48, and whatever isn't used is released.\n\nThat's about $8.80 more than the $18.45 estimate. Do you still want it?",
    cart: { ...exact("$27.25", "$14.40", { max_charge: "$29.48", store_total: "$26.59", price_change: { card_price: "$18.00", store_price: "$14.40" } }), fees: "$12.85" },
    earlier: ["$18.45", "$18.00"],
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "a rental deposit is not a price of the cart",
    reply: "Your booking is ready: a Volkswagen Taos or similar (Compact) from Sixt, picked up at LAX on Fri, Dec 18 at 10:00 and returned Mon, Dec 21 at 10:00. The total is $210.29. The driver is Jane Doe. Cancellation is free until Wed, Dec 16 at 10:00, then non-refundable. Sixt holds a $200 deposit at pick-up.\n\nSay yes to book it.",
    cart: { store: "Sixt", items: [line("$205.16", "Volkswagen Taos or similar")], fees: "$5.13", total: "$210.29", total_is_estimate: false, max_charge: "$230.81" },
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "an estimate with the most the card is held for names the charge",
    reply: "Got it, it ships to 1 Ferry Plz, San Francisco, CA 94111. Your cart comes to about $6.79 before tax and shipping; the card is held for at most $17.69, and only the store's exact total is charged. Say yes to place the order.",
    cart: estimate("$6.79", "$6.62", "$17.69", "$0.17"),
    asks: "pay_or_book",
    quotesTheCharge: true,
    wrong: false,
  },
  {
    name: "a yes with no amount does not name the charge",
    reply: "Got it, it ships to 1 Ferry Plz, San Francisco, CA 94111. Say yes to place the order.",
    cart: estimate("$49.17", "$47.97", "$61.31", "$1.20"),
    asks: "pay_or_book",
    quotesTheCharge: false,
    wrong: false,
  },
  {
    name: "an address read back is not the yes that pays",
    reply: "Is it 1 Ferry Plz, San Francisco, CA 94111? Say yes, or send me the right address.",
    cart: estimate("$15.34", "$14.97", "$26.49", "$0.37"),
    asks: "confirm_address",
    wrong: false,
  },
  {
    name: "an offer to add a product with no cart yet",
    reply: "Parts Town has the Taylor Precision 5932 Oven Thermometer (3 dial, with glass lens), sold by Singer H&R, for $6.62.\n\nWant me to add the Taylor Precision 5932 Oven Thermometer to your cart?",
    cart: null,
    asks: "add_to_cart",
    wrong: false,
  },
  {
    name: "a size and a length are the product's own options",
    reply: "Which size and length for Adult Relaxed T-shirt? Size: XS, S, M, L, XL, XXL, XXXL · Length: Regular, Tall",
    cart: null,
    asks: "product_option",
    wrong: false,
  },
  {
    name: "a store still pricing, asking nothing",
    reply: "Parts Town is still pricing your order, about 3 minutes in. It usually takes about 7. The estimate is still $6.79. Once the store's exact total arrives I'll post it here and ask for your approval.",
    cart: estimate("$6.79", "$6.62", "$17.69", "$0.17"),
    asks: "nothing",
    pricing: "still_pricing",
    wrong: false,
  },
  {
    name: "an offer to keep waiting or buy elsewhere",
    reply: "Parts Town still hasn't given a total after about 5 minutes. The estimate is $6.79. It usually takes about 7 minutes, so you have two choices:\n\n• Keep waiting for Parts Town's exact total\n• Buy the same thermometer from another store\n\nWhich would you like?",
    cart: estimate("$6.79", "$6.62", "$17.69", "$0.17"),
    asks: "keep_waiting_or_another_store",
    pricing: "still_pricing",
    wrong: false,
  },
  {
    name: "a line price the cart does not carry is a wrong amount",
    reply: "The 12-count pack is in your cart, but Amazon now lists it at $8.49. The $6.49 you saw was for the 8-count pack.\n\nDo you still want the 12-count pack at $8.49?",
    cart: estimate("$6.65", "$6.49", "$17.55", "$0.16"),
    asks: "pay_or_book",
    wrong: true,
  },
  {
    name: "still working on the last message",
    reply: "Still working on this one. Give me a moment.",
    cart: null,
    asks: "nothing",
    stillWorking: true,
    wrong: false,
  },
];

export default cases.map((one) =>
  defineEval({
    description: `reply reader: ${one.name}`,
    tags: ["judge"],
    async test(t) {
      const reading = await modelReader({ reply: one.reply, cart: one.cart, nextAction: null, earlier: one.earlier ?? [] });
      const score = (label: string, right: boolean, message: string) => t.score({ score: right ? 1 : 0, message }).label(label).gate(1);
      score("reads-what-it-asks", reading.asks === one.asks, `expected ${one.asks}, read ${reading.asks}`);
      score("reads-wrong-amounts", reading.wrongAmounts.length > 0 === one.wrong, `expected ${one.wrong ? "a wrong amount" : "no wrong amount"}, read: ${reading.wrongAmounts.map((amount) => `${amount.amount} (${amount.why})`).join("; ") || "none"}`);
      if (one.pricing !== undefined) score("reads-pricing", reading.pricing === one.pricing, `expected ${one.pricing}, read ${reading.pricing}`);
      if (one.stillWorking !== undefined) score("reads-still-working", reading.stillWorking === one.stillWorking, `expected ${one.stillWorking}, read ${reading.stillWorking}`);
      if (one.quotesTheCharge !== undefined) score("reads-the-charge", reading.quotesTheCharge === one.quotesTheCharge, `expected ${one.quotesTheCharge}, read ${reading.quotesTheCharge}`);
    },
  }),
);
