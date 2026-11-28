import { defineEval } from "eve/evals";
import { findSaying, modelReader, type Ask, type CartFields, type Detail, type Reading } from "../lib/reply-reader.ts";

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
  /** What the reply asks, or the readings that are each right for a reply that asks two things at once. */
  asks: Ask | Ask[];
  pricing?: Reading["pricing"];
  stillWorking?: boolean;
  quotesTheCharge?: boolean;
  wrong: boolean;
  /** What the shopper typed before, in order, when it matters to the reading. */
  shopper?: string[];
  choiceField?: { name: string; options: string[] }[];
  details?: Detail[];
  /** The detail the reply says was refused, and whether it says why. */
  refused?: { detail: Detail; reasonGiven: boolean };
  /** For each named choice, the value that fits the shopper's ask, or null when none can. */
  fits?: Record<string, string | null>;
  /** True when the reply asks about something the shopper already settled. */
  alreadySaid?: boolean;
  offerAt?: string | null;
  storeSays?: Reading["storeSays"];
  /** How many products the reply asks the shopper to choose among. */
  products?: number;
  /** False when every product the reply offers misses the shopper's ask. */
  productsFit?: boolean;
  offersNextStep?: boolean;
  /** The charges the reply names beyond the lines, by kind. */
  charges?: string[];
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
    charges: ["shipping", "tax"],
    wrong: false,
  },
  {
    name: "a price change asked as 'say yes to buy it at that price' is the yes, and its parts are true",
    reply: "Stanley 16 oz Smooth Face Nailing Rip Claw Hammer at Ace Hardware: the card showed $26.99 and Ace Hardware charges $28.99 for it, so it comes to $41.65 with tax and shipping. Say yes to buy it at that price. heads up: shipping is $10.16, so with $2.50 tax it comes to $41.65.",
    cart: exact("$41.65", "$28.99", { price_change: { card_price: "$26.99", store_price: "$28.99" } }),
    earlier: ["$26.99"],
    asks: "pay_or_book",
    quotesTheCharge: true,
    charges: ["shipping", "tax"],
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
  {
    name: "a guest checkout's contact details",
    reply: "Ace Hardware needs your email, full name and phone number for guest checkout. What should I use?",
    cart: null,
    asks: "contact_details",
    details: ["email", "name", "phone"],
    wrong: false,
  },
  {
    name: "details the reply only thanks the shopper for are not asked",
    reply: "I have the name (Jane Doe) and phone number. What's the delivery address?",
    cart: null,
    shopper: ["a Stanley hammer from Ace Hardware", "Jane Doe, 415-555-0137"],
    asks: "address",
    details: [],
    wrong: false,
  },
  {
    name: "a refused email with its reason",
    reply: "The restaurant couldn't take jane.doe@example.com: it's a reserved example address, not one that can receive the confirmation. What email should I use for the table?",
    cart: null,
    shopper: ["a table for two at an Italian restaurant in San Francisco", "I want number 1", "Jane Doe, jane.doe@example.com, 415-555-0137"],
    asks: "contact_details",
    details: ["email"],
    refused: { detail: "email", reasonGiven: true },
    wrong: false,
  },
  {
    name: "a phone asked for again with no reason",
    reply: "What phone number should go on the booking?",
    cart: null,
    shopper: ["a table for two at an Italian restaurant in San Francisco", "I want number 1", "Jane Doe, evals@agentcard.sh, +61 491 570 006"],
    asks: "contact_details",
    details: ["phone"],
    refused: { detail: "phone", reasonGiven: false },
    wrong: false,
  },
  {
    name: "the size asked for is sold out, and asking again is fair",
    reply: "This shirt comes in black in S, L and XL. M is sold out. Which one, or should I look for another shirt?",
    cart: null,
    shopper: ["a black cotton crewneck t-shirt for men in size medium from Gap", "I want number 1: Crew-Neck T-Shirt, $5.99"],
    asks: "product_option",
    fits: { Size: null },
    alreadySaid: false,
    wrong: false,
  },
  {
    name: "the colour asked for, in the store's own words",
    reply: "Which colour do you want?",
    cart: null,
    choiceField: [{ name: "Color", options: ["Navy", "Jet Black", "White"] }],
    shopper: ["a black cotton crewneck t-shirt for men in size medium from Gap", "I want number 2"],
    asks: "product_option",
    fits: { Color: "Jet Black" },
    wrong: false,
  },
  {
    name: "a choice the shopper said nothing about takes the first value",
    reply: "Which filling do you want for the Crunchy Taco?",
    cart: null,
    choiceField: [{ name: "Filling", options: ["Seasoned Beef", "Chicken"] }],
    shopper: ["one Crunchy Taco from Taco Bell on DoorDash", "I want number 1"],
    asks: "product_option",
    fits: { Filling: "Seasoned Beef" },
    alreadySaid: false,
    wrong: false,
  },
  {
    name: "a size the shopper already named is asked again",
    reply: "Which size do you want? Size: S, M, L, XL",
    cart: null,
    shopper: ["a black cotton crewneck t-shirt for men in size medium from Gap", "I want number 1"],
    asks: "product_option",
    alreadySaid: true,
    wrong: false,
  },
  {
    name: "restating the shopper's choice before the next question is not asking again",
    reply: "The 68\" Jade Harmony Yoga Mat from JadeYoga is $99.95. Which color do you want?\n• Purple\n• Black\n• Teal",
    cart: null,
    shopper: ["a Jade Harmony yoga mat from jadeyoga.com", "I want number 1: Jade Harmony Yoga Mat - JadeYoga, $99.95", "68\" Length"],
    asks: "product_option",
    alreadySaid: false,
    wrong: false,
  },
  {
    name: "asking to confirm the shopper's own choice is not asking again",
    reply: "Do you want Corzetti at 7:00 PM for two on Friday, Dec 4?",
    cart: null,
    shopper: ["a table for two at an Italian restaurant in San Francisco on Friday, December 4 at 7pm", "I want number 5: Corzetti", "7:00 PM"],
    asks: ["add_to_cart", "pay_or_book", "other_question"],
    alreadySaid: false,
    wrong: false,
  },
  {
    name: "how many tickets, after the shopper said two",
    reply: "How many tickets do you need?",
    cart: null,
    shopper: ["two tickets to a New York Knicks home game in January", "I want number 3"],
    asks: "how_many",
    alreadySaid: true,
    wrong: false,
  },
  {
    name: "which of several products, with their stores",
    reply: "I found two listings of the ribbed tee.\n\n1. Ribbed Stretch-cotton Crew-neck T-shirt, $44.99 at Bananarepublic\n2. Ribbed Stretch-Cotton Crew-Neck T-Shirt, $44.99 at Gap\n\nWhich one do you want?",
    cart: null,
    asks: "other_question",
    products: 2,
    wrong: false,
  },
  {
    name: "a product offered in another colour than asked does not fit the ask",
    reply: "I couldn't add the Crew-Neck T-Shirt to your cart. It has no medium in stock. Want me to look for a black medium tee at another store? Or you could take the Adult Heavyweight Relaxed T-shirt at Gap, $35.00, in Dark night, the closest color it comes in.",
    cart: null,
    shopper: ["a black cotton crewneck t-shirt for men in size medium from Gap", "I want number 1: Gap Adult Heavyweight Relaxed T-shirt, $35.00", "yes"],
    asks: ["other_question", "add_to_cart"],
    productsFit: false,
    wrong: false,
  },
  {
    name: "an offer to add names the store it is at",
    reply: "The closest swap is the Mountain Tee at Kohl's, $19.99. It has a mountain design. Want me to add it?",
    cart: null,
    asks: "add_to_cart",
    offerAt: "Kohl's",
    wrong: false,
  },
  {
    name: "a product no longer in stock",
    reply: "Amazon no longer has the 8-count Amazon Basics AA batteries in stock, so I couldn't add them. Your cart is empty.",
    cart: null,
    asks: "nothing",
    storeSays: "out_of_stock",
    wrong: false,
  },
  {
    name: "nothing to book for two",
    reply: "I checked all eight Knicks home games in January and there's nothing to book for two right now: no pairs of tickets are listed.",
    cart: null,
    asks: "nothing",
    storeSays: "no_availability",
    wrong: false,
  },
  {
    name: "a checkout that failed is not the store's own answer",
    reply: "I couldn't get through Uniqlo's checkout this time. Nothing was ordered or charged.",
    cart: null,
    asks: "nothing",
    storeSays: null,
    wrong: false,
  },
  {
    name: "a store closed for the Sabbath, with the item moved to another store",
    reply: "B&H Photo Video's checkout is closed for now (it says: \"Checkout will be available at 11/28/2026, 5:45 PM ET Sat night (in 19hr and 45min)\"), so I put the same Delkin 64GB card in your cart at Adorama at the same price, $29.99.",
    cart: { store: "Adorama", items: [line("$29.99", "Delkin 64GB SD card")], fees: null, total: "$29.99", total_is_estimate: true },
    asks: ["nothing", "address", "other_question", "pay_or_book"],
    storeSays: "checkout_closed",
    offersNextStep: true,
    wrong: false,
  },
  {
    name: "a store closed for now, with when it opens again",
    reply: "B&H Photo Video's checkout is closed for now. It says checkout will be available again Saturday at 5:45 PM ET. No other store I can buy from has this card, so nothing was ordered or charged.",
    cart: null,
    asks: "nothing",
    storeSays: "checkout_closed",
    offersNextStep: true,
    wrong: false,
  },
  {
    name: "an item the supplier says is no longer available, with another store offered",
    reply: "While pricing your order, Ace Hardware's supplier said the Stanley 16 oz hammer is no longer available, so nothing was ordered or charged. Want me to look for the same hammer at another store?",
    cart: null,
    asks: ["add_to_cart", "other_question"],
    storeSays: "no_longer_available",
    offersNextStep: true,
    wrong: false,
  },
  {
    name: "a checkout that would not respond is not closed, and offers nothing",
    reply: "Ace Hardware's site wouldn't respond at checkout. Nothing was ordered or charged.",
    cart: null,
    asks: "nothing",
    storeSays: null,
    offersNextStep: false,
    wrong: false,
  },
  {
    name: "as listed or changed",
    reply: "Do you want it as listed: True black, M, or changed?",
    cart: null,
    shopper: ["a black cotton crewneck t-shirt for men in size medium from Gap", "I want number 1"],
    asks: "as_listed",
    wrong: false,
  },
];

export default [
  defineEval({
    description: "reply reader: a question about a size is not asking whether to add",
    tags: ["judge"],
    async test(t) {
      const replies = ["Which size should I add for the Jade Harmony Yoga Mat? 68\" Length, 74\" Length", "Want me to add the Hydro Flask Standard Mouth bottle to your cart?", "Added it. What's the delivery address?"];
      const found = await findSaying(replies, "asks the shopper whether to add, get or buy the product (\"Want me to add it?\"), as opposed to asking which size, colour or other option of it they want");
      t.score({ score: JSON.stringify(found) === JSON.stringify([1]) ? 1 : 0, message: `expected [1], read ${JSON.stringify(found)}` }).label("finds-what-a-reply-says").gate(1);
    },
  }),
  ...cases.map((one) =>
  defineEval({
    description: `reply reader: ${one.name}`,
    tags: ["judge"],
    async test(t) {
      const reading = await modelReader({ reply: one.reply, cart: one.cart, nextAction: null, earlier: one.earlier ?? [], shopper: one.shopper ?? [], ...(one.choiceField ? { choiceField: one.choiceField } : {}) });
      const score = (label: string, right: boolean, message: string) => t.score({ score: right ? 1 : 0, message }).label(label).gate(1);
      const asks = Array.isArray(one.asks) ? one.asks : [one.asks];
      score("reads-what-it-asks", asks.includes(reading.asks), `expected ${asks.join(" or ")}, read ${reading.asks}`);
      score("reads-wrong-amounts", reading.wrongAmounts.length > 0 === one.wrong, `expected ${one.wrong ? "a wrong amount" : "no wrong amount"}, read: ${reading.wrongAmounts.map((amount) => `${amount.amount} (${amount.why})`).join("; ") || "none"}`);
      if (one.pricing !== undefined) score("reads-pricing", reading.pricing === one.pricing, `expected ${one.pricing}, read ${reading.pricing}`);
      if (one.stillWorking !== undefined) score("reads-still-working", reading.stillWorking === one.stillWorking, `expected ${one.stillWorking}, read ${reading.stillWorking}`);
      if (one.quotesTheCharge !== undefined) score("reads-the-charge", reading.quotesTheCharge === one.quotesTheCharge, `expected ${one.quotesTheCharge}, read ${reading.quotesTheCharge}`);
      if (one.details) score("reads-the-details", [...reading.details].sort().join() === [...one.details].sort().join(), `expected ${one.details.join(", ") || "none"}, read ${reading.details.join(", ") || "none"}`);
      if (one.refused) {
        const found = reading.refused.find((r) => r.detail === one.refused!.detail);
        score("reads-a-refused-detail", found !== undefined && found.reasonGiven === one.refused.reasonGiven, `expected ${one.refused.detail} refused ${one.refused.reasonGiven ? "with" : "without"} a reason, read ${JSON.stringify(reading.refused)}`);
      }
      if (one.fits)
        for (const [choice, value] of Object.entries(one.fits)) {
          const fit = reading.fits.find((f) => f.choice.toLowerCase().includes(choice.toLowerCase()));
          score("reads-the-value-that-fits", fit !== undefined && (fit.value ?? null) === value, `expected ${choice}: ${value}, read ${JSON.stringify(reading.fits)}`);
        }
      if (one.alreadySaid !== undefined) score("reads-a-question-already-answered", reading.alreadySaid.length > 0 === one.alreadySaid, `expected ${one.alreadySaid ? "a question already answered" : "none"}, read ${JSON.stringify(reading.alreadySaid)}`);
      if (one.offerAt !== undefined) score("reads-where-an-offer-is", (reading.offerAt ?? "").toLowerCase().includes((one.offerAt ?? "").toLowerCase().slice(0, 4)) && (one.offerAt === null) === (reading.offerAt === null), `expected ${one.offerAt}, read ${reading.offerAt}`);
      if (one.storeSays !== undefined) score("reads-the-stores-answer", reading.storeSays === one.storeSays, `expected ${one.storeSays}, read ${reading.storeSays}`);
      if (one.charges) score("reads-the-charges", [...reading.charges.map((charge) => charge.kind)].sort().join() === [...one.charges].sort().join(), `expected ${one.charges.join(", ")}, read ${JSON.stringify(reading.charges)}`);
      if (one.offersNextStep !== undefined) score("reads-a-way-on", reading.offersNextStep === one.offersNextStep, `expected ${one.offersNextStep}, read ${reading.offersNextStep}`);
      if (one.productsFit !== undefined) score("reads-whether-products-fit", reading.products.some((product) => product.fitsTheAsk) === one.productsFit, `expected ${one.productsFit ? "a product that fits" : "no product that fits"}, read ${JSON.stringify(reading.products)}`);
      if (one.products !== undefined) score("reads-the-products-offered", reading.products.length === one.products, `expected ${one.products}, read ${reading.products.length}`);
    },
  }),
  ),
];
