import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";
import { z } from "zod";

/** One thing the shopper asked for, and what must be true of a product for it to be that thing. */
export interface Want {
  /** The thing, in a few words: `screen protector`. */
  what: string;
  /** Each requirement the shopper's words put on it, one fact each: `made for the iPhone 16, not the Plus, Pro or Pro Max`. */
  must: string[];
}

/** The judge's reading of one answer. */
export interface Verdict {
  /** One entry per card, in the cards' order. `accurate` is true when the card is one of the wanted things and breaks none of its requirements. */
  cards: { index: number; accurate: boolean; unmet: string[] }[];
  /** The wanted things no accurate card covers. */
  uncovered: string[];
  /** Products a reply recommends that are not accurate cards, each with why. */
  badRecommendations: string[];
  /** Statements in Agentcard's reply that the cards contradict. */
  agentcardFalseClaims: string[];
  /** Statements in the chat agent's reply that the cards contradict. */
  agentFalseClaims: string[];
  /** True when the replies respond to what was asked: they offer it, ask for what is needed to get it, or say plainly it was not found. */
  answersTheAsk: boolean;
  answerNote: string;
  /** True when either reply says, before it offers anything else, that a store the shopper named had nothing, could not be searched or cannot be shopped at. */
  saysNamedStoreMissed: boolean;
}

const Reading = z.object({
  cards: z.array(
    z.object({
      card: z.number().int().describe("The card's number, starting at 1."),
      want: z.number().int().describe("The number of the wanted thing this card is, starting at 1, or 0 when it is none of them."),
      unmet: z.array(z.string()).describe("The requirements of that wanted thing the card clearly breaks, copied as written. Empty when it breaks none."),
    }),
  ),
  recommended: z.array(z.number().int()).describe("The numbers of the cards either reply recommends or suggests by name."),
  recommended_not_shown: z.array(z.string()).describe("Products either reply recommends by name that are on no card."),
  false_claims: z.array(z.object({ reply: z.enum(["agentcard", "agent"]), claim: z.string().describe("The statement, quoted, with the fact that contradicts it.") })).describe("Each statement in a reply that the cards contradict."),
  answers_the_ask: z.boolean(),
  says_named_store_missed: z.boolean().describe("True only when Agentcard's reply or the chat agent's reply says plainly, before it offers anything else, that a store the shopper named had nothing for this, could not be searched, or cannot be shopped at. False when the shopper named no store, or the reply offers other stores without saying so first."),
  answer_note: z.string().describe("One sentence on why the replies do or do not respond to the ask."),
});

const RULES = [
  "You check a shopping assistant's answer for accuracy. A shopper asked for something. The assistant put product cards in the chat and wrote two replies: Agentcard's reply and the chat agent's own short reply.",
  "For every card, decide which wanted thing it is, if any, and which of that thing's requirements it clearly breaks.",
  "Judge a card only by its name, its store and its price. A requirement the card says nothing about is NOT broken: a shoe whose name gives no size does not break `size 10`, and a pack whose count is not what was asked does not break a quantity the shopper can reach by buying more than one.",
  "A requirement is broken only when the card states something that contradicts it: another phone model, another brand than the one named, a resolution other than the one asked, a different kind of product.",
  "A card made for several models fits when the asked model is among them. A card for a different model, such as an iPhone 16 Pro Max screen protector for an iPhone 16 ask, breaks the model requirement.",
  "An accessory for the wanted thing is not the wanted thing, unless an accessory is what was asked for.",
  "Never count taste against a card: words such as `decent`, `nice` or `nothing fancy` break nothing.",
  "For the replies, list a false claim only when the cards contradict it: a price that differs from the card's, a product presented as shown that is on no card, a card described as something its name says it is not, or a statement that everything shown fits when cards break requirements. Opinions, tone, length and the number of questions are never false claims. The two replies may differ in what they recommend; that is not a false claim.",
  "Read a claim for what it is about. `Everything here is inside your budget` is about prices only, and `ten options` is a count: check each against that one thing, not against the other requirements.",
  "The card numbers are this prompt's own. A reply that says `number 2` or `#1` counts in its own list, which may be in another order, so match a reply's products to cards by name and never by number.",
  "A reply may also mention a product from the list of products found but not shown; that is not a false claim, though its price must still match.",
  "When the test's author says what a right answer looks like, hold the replies to it in `answers_the_ask`: a reply in the wrong language, or one that hides that a store or a service is not available, does not answer the ask.",
  "A reply that asks the shopper a clarifying question always answers the ask: never mark asking a question as a failure.",
  "The replies answer the ask when, between them, they offer what was asked for, or ask the shopper for what is needed to get it, or say plainly that it was not found. They do not answer it when they ignore part of the ask, or present something else as if it were what was asked.",
].join("\n");

/**
 * Reads every card against every requirement of the ask, and both replies against the cards. Runs on Claude Opus with
 * the same Anthropic key as the agent. The rules it follows are checked by evals/judge/calibration.eval.ts, which feeds
 * it answers whose faults are known.
 */
export async function judge(
  expected: { ask: string; wants: Want[]; context?: string },
  cards: { name: string; store: string | null; price: string | null }[],
  replies: { agentcard: string; agent: string },
  notShown: { name: string; store: string | null; price: string | null }[] = [],
): Promise<Verdict> {
  const { output } = await generateText({
    model: anthropic("claude-opus-5-5"),
    output: Output.object({ schema: Reading }),
    system: RULES,
    prompt: [
      `What the shopper typed: ${expected.ask}`,
      `What they want:\n${expected.wants.map((want, index) => `${index + 1}. ${want.what}. Requirements: ${want.must.map((must) => `"${must}"`).join("; ") || "none beyond being that thing"}`).join("\n")}`,
      ...(expected.context ? [`What a right answer looks like, from the test's author: ${expected.context}`] : []),
      `Cards in the chat:\n${cards.map((card, index) => `${index + 1}. ${card.name} | ${card.store ?? "no store"} | ${card.price ?? "no price"}`).join("\n") || "(none)"}`,
      `Products found but not shown as cards:\n${notShown.map((card) => `- ${card.name} | ${card.store ?? "no store"} | ${card.price ?? "no price"}`).join("\n") || "(none)"}`,
      `Agentcard's reply: ${replies.agentcard || "(none)"}`,
      `The chat agent's reply: ${replies.agent || "(none)"}`,
    ].join("\n\n"),
  });
  const read = new Map(output.cards.map((card) => [card.card - 1, card]));
  const graded = cards.map((_, index) => {
    const card = read.get(index);
    const wanted = card !== undefined && card.want >= 1 && card.want <= expected.wants.length;
    return { index, want: wanted ? card.want - 1 : -1, accurate: wanted && card.unmet.length === 0, unmet: card?.unmet ?? ["the judge did not read this card"] };
  });
  const covered = new Set(graded.filter((card) => card.accurate).map((card) => card.want));
  return {
    cards: graded,
    uncovered: cards.length === 0 ? [] : expected.wants.filter((_, index) => !covered.has(index)).map((want) => want.what),
    badRecommendations: [
      ...output.recommended.filter((number) => graded[number - 1] && !graded[number - 1]!.accurate).map((number) => `card ${number} ${cards[number - 1]!.name.slice(0, 60)}: ${graded[number - 1]!.unmet.join(", ") || "not something that was asked for"}`),
      ...output.recommended_not_shown.map((name) => `${name}: recommended but on no card`),
    ],
    agentcardFalseClaims: output.false_claims.filter((claim) => claim.reply === "agentcard").map((claim) => claim.claim),
    agentFalseClaims: output.false_claims.filter((claim) => claim.reply === "agent").map((claim) => claim.claim),
    answersTheAsk: output.answers_the_ask,
    answerNote: output.answer_note,
    saysNamedStoreMissed: output.says_named_store_missed,
  };
}
