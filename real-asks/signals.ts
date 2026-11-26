import { cardsOf } from "./cards.ts";
import type { Conversation, Day, Message, Product } from "./read.ts";
import { alike, meaning } from "./scrub.ts";

/**
 * The signs that a shopper's message did not get a good answer, read from what the backend stored with fixed rules:
 * no model, no cost. The judge (pick.ts) adds the one sign a rule cannot give: whether the products shown were what
 * was asked for.
 */

/** One shopper message with everything said until the next one. */
export interface Turn {
  conversation: Conversation;
  ask: Message;
  /** The shopper's earlier messages in the conversation, oldest first. */
  earlier: Message[];
  /** What Agentcard said back, in order. */
  replies: Message[];
  /** The shopper's next message, or null when this is the last. */
  next: Message | null;
  /** The products of the conversation's last search, when this is the message that search answered; null otherwise. Read through `cardsOf` (cards.ts). */
  lastSearch: Product[] | null;
}

export type Sign = "no answer" | "refused" | "nothing found" | "rephrased" | "said it was wrong" | "left after the first answer" | "checkout failed";

/** The signs that pick a message on their own. The other two only count: see `picks`. */
export const PICKS: Sign[] = ["said it was wrong", "rephrased", "nothing found", "refused", "no answer"];

/** The day's conversations cut into turns, in order. */
export function turnsOf(day: Day): Turn[] {
  const byConversation = new Map<string, Message[]>();
  for (const message of day.messages) {
    if (!byConversation.has(message.conversation)) byConversation.set(message.conversation, []);
    byConversation.get(message.conversation)!.push(message);
  }
  const turns: Turn[] = [];
  for (const conversation of day.conversations) {
    const messages = (byConversation.get(conversation.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const asks = messages.filter((message) => message.role === "visitor");
    asks.forEach((ask, index) => {
      const next = asks[index + 1] ?? null;
      turns.push({
        conversation,
        ask,
        earlier: asks.slice(0, index),
        replies: messages.filter((message) => message.role === "agent" && message.at >= ask.at && (!next || message.at < next.at)),
        next,
        lastSearch: conversation.productsFor === ask.id ? conversation.products : null,
      });
    });
  }
  return turns;
}

const NOT_FOUND = /\b(could ?n[o']?t find|did ?n[o']?t find|unable to find|not able to find|no (results|matches|matching|products|options|luck)|nothing (came up|matched|matching|turned up)|came up empty|don'?t (have|carry|see) (any|that|it)|is ?n[o']?t (available|supported|something i can)|can'?t (help with|buy|order|search) (that|this|from)|no encontr[eéó]|n[ãa]o encontrei|n'ai (pas|rien) trouv|nichts gefunden|niets gevonden)\b/i;
const WRONG = /\b(wrong|incorrect|not (right|correct)|not what i (asked|wanted|meant|said)|that'?s not|thats not|those are ?n[o']?t|these are ?n[o']?t|i (said|asked for|meant|wanted)|did ?n[o']?t ask|you (missed|ignored|forgot)|try again|doesn'?t match|no[,.!]+ ?(i|not|that|those|these|the)\b|not helpful|useless|eso no es|no es lo que|n[ãa]o [ée] isso|ce n'est pas|das ist nicht|dat is niet)\b/i;
/** A typed message that only answers: a yes, a no, a number picked from a list. */
const ANSWER = /^(yes|yep|yeah|ok(ay)?|sure|no|nope|confirm|cancel|go ahead|do it|the (first|second|third|last|\d+(st|nd|rd|th)) one|#?\d{1,2}|s[ií]|sim|oui|ja|nee|non)[\s.!]*$/i;

const MINUTES = 60 * 1000;

/** The signs one turn shows. */
export function signsOf(turn: Turn, failedCheckout: boolean): Sign[] {
  const signs: Sign[] = [];
  const typed = !turn.ask.tapped && !ANSWER.test(turn.ask.body.trim());
  const handed = turn.replies.map((reply) => reply.turn).filter((handed) => handed !== null);
  const text = turn.replies.map((reply) => reply.body).join("\n");
  const searched = handed.some((answer) => answer.tools.some((tool) => /search|web/i.test(tool)));
  const checkout = handed.some((answer) => answer.declineCode || answer.errorCode || (answer.status === "declined" && (answer.cart || /approve|add_card|guest_details/.test(answer.nextAction ?? ""))));

  if (turn.replies.length === 0) signs.push("no answer");
  if (checkout || failedCheckout) signs.push("checkout failed");
  else if (typed && handed.some((answer) => answer.status === "declined")) signs.push("refused");
  // A search that stored no products for this message, or a reply that says it found nothing.
  if (typed && searched && !checkout && (NOT_FOUND.test(text) || cardsOf(turn)?.cards.length === 0)) signs.push("nothing found");
  if (typed && turn.next && !turn.next.tapped) {
    const soon = Date.parse(turn.next.at) - Date.parse(turn.ask.at) <= 15 * MINUTES;
    // The same thing asked again in other words: at least half the meaning words shared, and more than a word or two.
    // Only after a search: a shopper who repeats the ask with the address Agentcard asked for is answering, not asking again.
    if (soon && searched && meaning(turn.ask.body).size >= 2 && alike(turn.ask.body, turn.next.body) >= 0.5) signs.push("rephrased");
    if (WRONG.test(turn.next.body)) signs.push("said it was wrong");
  }
  if (typed && turn.earlier.length === 0 && turn.next === null && turn.replies.length > 0) signs.push("left after the first answer");
  return signs;
}

/** True when the turn is a typed ask, not a tap and not a bare yes or no: the only kind worth sending again. */
export function typedAsk(turn: Turn): boolean {
  return !turn.ask.tapped && !ANSWER.test(turn.ask.body.trim()) && meaning(turn.ask.body).size >= 1;
}

/**
 * The signs that pick a turn on their own. A shopper who leaves after the first answer may simply have been done, and
 * a checkout that failed is not something an eval can send again, since no eval ever places an order: both are counted
 * in the day's summary, and neither saves a row by itself.
 */
export function picks(signs: Sign[]): Sign[] {
  return PICKS.filter((sign) => signs.includes(sign));
}
