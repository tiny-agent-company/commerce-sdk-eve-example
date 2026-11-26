import { defineEval } from "eve/evals";
import { checkAnswer, checkWordsUnchanged, type Expectation } from "../lib/buy.js";

/**
 * One shopper message each. `wants` spells out what the shopper asked for, one fact per requirement, so the judge
 * checks every card against the ask rather than against its own idea of a good answer.
 */
const cases: (Expectation & { name: string })[] = [
  { name: "plain product", ask: "wireless earbuds", wants: [{ what: "wireless earbuds", must: ["earbuds or in-ear headphones", "wireless"] }] },
  { name: "brand and model", ask: "Sony WH-1000XM5 headphones", wants: [{ what: "Sony WH-1000XM5 headphones", must: ["made by Sony", "the WH-1000XM5 model, not another model", "the headphones themselves, not a case, pads or another accessory"] }] },
  { name: "named store", ask: "AA batteries from Amazon", store: /amazon/i, wants: [{ what: "AA batteries", must: ["batteries", "AA size"] }] },
  { name: "another named store", ask: "a cast iron skillet from Walmart", store: /walmart/i, wants: [{ what: "cast iron skillet", must: ["a skillet or frying pan", "made of cast iron"] }] },
  { name: "budget ceiling", ask: "a yoga mat under $30", maxPrice: 30, wants: [{ what: "yoga mat", must: ["a yoga or exercise mat", "costs under $30"] }] },
  { name: "price range", ask: "running socks between $10 and $20", minPrice: 10, maxPrice: 20, wants: [{ what: "running socks", must: ["socks", "for running or sport", "costs between $10 and $20"] }] },
  { name: "quantity", ask: "two packs of AA batteries", wants: [{ what: "AA batteries", must: ["batteries", "AA size"] }] },
  { name: "size and colour", ask: "men's black running shoes size 10", wants: [{ what: "running shoes", must: ["running shoes", "for men", "black", "size 10"] }] },
  { name: "technical specs", ask: "a 27 inch 4K monitor with USB-C", wants: [{ what: "monitor", must: ["a computer monitor", "27 inch", "4K resolution", "has USB-C"] }] },
  { name: "misspelled", ask: "iphone chargr usb c", wants: [{ what: "iPhone USB-C charger", must: ["a charger or charging cable", "USB-C", "works with an iPhone"] }] },
  { name: "vague gift", ask: "a birthday gift for my dad who likes fishing, around $50", maxPrice: 75, wants: [{ what: "fishing gift", must: ["something for fishing or a fishing-themed gift", "costs around $50, at most $75"] }] },
  { name: "Spanish with a budget", ask: "quiero comprar una cafetera italiana por menos de 40 dólares", maxPrice: 40, wants: [{ what: "moka pot (cafetera italiana)", must: ["a stovetop moka pot coffee maker", "costs under $40"] }] },
  { name: "long and chatty", ask: "hey so my blender just died, can you find me a decent one that can crush ice? nothing fancy", wants: [{ what: "blender", must: ["a blender", "a blender that sits on a counter and plugs in, a personal countertop one such as a NutriBullet included, that can crush ice: not a hand or immersion blender, and not a portable, cordless or rechargeable travel cup blender"] }] },
  {
    name: "several things at once",
    ask: "a phone case and a screen protector for an iPhone 16",
    wants: [
      { what: "phone case", must: ["a phone case", "made for the iPhone 16, not only the Plus, Pro, Pro Max or another model"] },
      { what: "screen protector", must: ["a screen protector", "made for the iPhone 16, not only the Plus, Pro, Pro Max or another model"] },
    ],
  },
  { name: "compatibility", ask: "a replacement filter for a Dyson V8 vacuum", wants: [{ what: "Dyson V8 filter", must: ["a vacuum filter", "fits the Dyson V8"] }] },
  { name: "what to leave out", ask: "a laptop backpack, not leather, no pink", wants: [{ what: "laptop backpack", must: ["a backpack that holds a laptop", "not leather", "not pink"] }] },
  { name: "use case, no product named", ask: "something to keep my coffee hot at my desk all day", wants: [{ what: "something that keeps coffee hot", must: ["a mug warmer, heated mug, insulated mug, tumbler or thermos"] }] },
  { name: "exact product", ask: "Apple AirPods Pro 2", wants: [{ what: "Apple AirPods Pro 2", must: ["made by Apple", "AirPods Pro, 2nd generation", "the earbuds themselves, not a case or another accessory"] }] },
  {
    name: "groceries",
    ask: "a dozen eggs and a gallon of milk",
    mayAsk: true,
    wants: [
      { what: "a dozen eggs", must: ["chicken eggs", "sold by the dozen or so, not a bulk case"] },
      { what: "a gallon of milk", must: ["milk", "about a gallon"] },
    ],
  },
  { name: "restaurant food", ask: "order me a chicken burrito for lunch", mayAsk: true, wants: [{ what: "chicken burrito", must: ["a burrito", "with chicken"] }] },
];

export default cases.map(({ name, ...expected }) =>
  defineEval({
    description: `search: ${name}`,
    tags: ["search"],
    metadata: { ask: expected.ask },
    async test(t) {
      const turn = await t.send(expected.ask);
      t.succeeded();
      turn.calledTool("buy");
      checkWordsUnchanged(t, turn, expected.ask);
      await checkAnswer(t, turn, expected);
    },
  }),
);
