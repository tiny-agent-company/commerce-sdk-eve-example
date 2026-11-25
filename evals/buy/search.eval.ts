import { defineEval } from "eve/evals";
import { checkSearch, type SearchExpectation } from "../lib/buy.js";

/** One shopper message each: what a shopper types when looking for a product, in the ways shoppers vary it. */
const cases: (SearchExpectation & { name: string })[] = [
  { name: "plain product", ask: "wireless earbuds", match: /earbud|earphone|headphone|airpod|buds/i },
  { name: "brand and model", ask: "Sony WH-1000XM5 headphones", match: /sony/i },
  { name: "named store", ask: "AA batteries from Amazon", match: /\bAA\b|batter/i, store: /amazon/i },
  { name: "another named store", ask: "a cast iron skillet from Walmart", match: /skillet|cast iron|pan/i, store: /walmart/i },
  { name: "budget ceiling", ask: "a yoga mat under $30", match: /yoga|mat/i, maxPrice: 30 },
  { name: "price range", ask: "running socks between $10 and $20", match: /sock/i, minPrice: 10, maxPrice: 20 },
  { name: "quantity", ask: "two packs of AA batteries", match: /\bAA\b|batter/i },
  { name: "size and colour", ask: "men's black running shoes size 10", match: /shoe|sneaker|runn|trainer/i },
  { name: "technical specs", ask: "a 27 inch 4K monitor with USB-C", match: /monitor|display/i },
  { name: "misspelled", ask: "iphone chargr usb c", match: /charg|usb|cable|adapter/i },
  { name: "vague gift", ask: "a birthday gift for my dad who likes fishing, around $50", maxPrice: 75 },
  { name: "Spanish with a budget", ask: "quiero comprar una cafetera italiana por menos de 40 dólares", match: /moka|cafetera|coffee|espresso|stovetop/i, maxPrice: 40 },
  { name: "long and chatty", ask: "hey so my blender just died, can you find me a decent one that can crush ice? nothing fancy", match: /blender/i },
  { name: "several things at once", ask: "a phone case and a screen protector for an iPhone 16", match: /case|protector|iphone/i },
  { name: "groceries", ask: "a dozen eggs and a gallon of milk", minProducts: 0 },
  { name: "restaurant food", ask: "order me a chicken burrito for lunch", minProducts: 0 },
];

export default cases.map(({ name, ...expected }) =>
  defineEval({
    description: `search: ${name}`,
    tags: ["search"],
    metadata: { ask: expected.ask },
    async test(t) {
      const turn = await t.send(expected.ask);
      t.succeeded();
      checkSearch(t, turn, expected);
    },
  }),
);
