import { defineEval } from "eve/evals";
import { judge } from "../lib/judge.js";

/**
 * Checks the judge itself. Each case hands it a made-up answer whose faults are known and fails when the judge misses
 * a fault or invents one. No shopper message is sent and the buy tool is not called.
 */
const iphone = {
  ask: "a screen protector for an iPhone 16",
  wants: [{ what: "screen protector", must: ["a screen protector", "made for the iPhone 16, not only the Plus, Pro, Pro Max or another model"] }],
};

const cases = [
  {
    name: "flags a card for another phone model",
    expected: iphone,
    cards: [
      { name: "iPhone 16 Tempered Glass Screen Protector 3-Pack", store: "Walmart", price: "$12.99" },
      { name: "Premium Glass iPhone 16 Pro Max Screen Protector", store: "CDW", price: "$15.99" },
      { name: "Clear iPhone 17 Pro Screen Protector", store: "Best Buy", price: "$39.99" },
    ],
    replies: { agentcard: "Here are a few screen protectors.", agent: "Which one do you want?" },
    accurate: [true, false, false],
    falseClaims: false,
  },
  {
    name: "passes a card that lists the asked model among others",
    expected: iphone,
    cards: [{ name: "Screen Protector for iPhone 16 / iPhone 15 / iPhone 14, 2 Pack", store: "Amazon", price: "$8.99" }],
    replies: { agentcard: "This one fits the iPhone 16.", agent: "Want it?" },
    accurate: [true],
    falseClaims: false,
  },
  {
    name: "does not count taste, or a size the card does not state",
    expected: { ask: "a decent pair of men's black running shoes size 10, nothing fancy", wants: [{ what: "running shoes", must: ["running shoes", "for men", "black", "size 10"] }] },
    cards: [
      { name: "Nike Revolution 8 Men's Running Shoes Black", store: "Walmart", price: "$179.95" },
      { name: "Brooks Ghost 16 Men's Running Shoe, Black/White", store: "Amazon", price: "$139.95" },
      { name: "Adidas Women's Cloudfoam Running Shoe, Pink", store: "Amazon", price: "$54.00" },
    ],
    replies: { agentcard: "A few black running shoes for men.", agent: "Which pair?" },
    accurate: [true, true, false],
    falseClaims: true,
  },
  {
    name: "flags a wrong price and a product that is on no card",
    expected: { ask: "AA batteries", wants: [{ what: "AA batteries", must: ["batteries", "AA size"] }] },
    cards: [{ name: "Duracell Coppertop AA Batteries, 24 Count", store: "Amazon", price: "$19.94" }],
    replies: { agentcard: "The Duracell 24 pack is $9.99. I'd also suggest the Energizer MAX 48 pack at $21.", agent: "Which one?" },
    accurate: [true],
    falseClaims: true,
  },
  {
    name: "raises nothing on a correct answer",
    expected: { ask: "a yoga mat under $30", wants: [{ what: "yoga mat", must: ["a yoga or exercise mat", "costs under $30"] }] },
    cards: [
      { name: "Gaiam Essentials Thick Yoga Mat", store: "Amazon", price: "$21.98" },
      { name: "BalanceFrom All Purpose 1/2-Inch Exercise Yoga Mat", store: "Walmart", price: "$16.99" },
    ],
    replies: { agentcard: "Two mats under $30. The Gaiam at $21.98 is the thicker one.", agent: "Found two under $30. Which one do you want?" },
    accurate: [true, true],
    falseClaims: false,
  },
];

export default cases.map((fixture) =>
  defineEval({
    description: `judge: ${fixture.name}`,
    tags: ["judge"],
    async test(t) {
      const verdict = await judge(fixture.expected, fixture.cards, fixture.replies);
      const claims = [...verdict.agentcardFalseClaims, ...verdict.agentFalseClaims];
      const read = verdict.cards.map((card) => card.accurate);
      t.score({
        score: JSON.stringify(read) === JSON.stringify(fixture.accurate) ? 1 : 0,
        message: `expected ${JSON.stringify(fixture.accurate)}, the judge read ${JSON.stringify(read)} (${verdict.cards.map((card) => card.unmet.join(",")).join(" | ")})`,
      })
        .label("reads-the-cards-right")
        .gate(1);
      t.score({
        score: claims.length > 0 === fixture.falseClaims ? 1 : 0,
        message: `expected ${fixture.falseClaims ? "a false claim" : "no false claim"}, the judge found: ${claims.join("; ") || "none"}`,
      })
        .label("reads-the-replies-right")
        .gate(1);
    },
  }),
);
