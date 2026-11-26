import type { Product } from "./read.ts";
import type { Turn } from "./signals.ts";

/** An answer shows at most this many products as cards; the backend keeps more of each search than it shows. */
export const CARDS_SHOWN = 8;

/** The product cards one answer put in front of the shopper. */
export interface Shown {
  cards: Product[];
  /** Products the search found past the cards, which a reply may still mention. */
  notShown: Product[];
  /** True when the backend stored the cards with the turn. False when they are a guess from the conversation's last search. */
  stored: boolean;
}

/**
 * The cards a turn showed, and the one place the job decides how it knows them.
 *
 * When the backend stored the cards with the turn, those are the cards: exact, and there for every turn of a chat.
 * When it did not, the only thing left is the conversation's last search, which keeps its products in order but not
 * which of them became cards: the first eight stand for the cards and the rest for products found and not shown. That
 * guess exists only for the message the last search answered. For any other turn nothing is known, and this returns null.
 */
export function cardsOf(turn: Turn): Shown | null {
  const stored = turn.replies.map((reply) => reply.turn?.cards).filter((cards): cards is Product[] => Array.isArray(cards));
  if (stored.length > 0) return { cards: stored.flat(), notShown: [], stored: true };
  if (turn.lastSearch) return { cards: turn.lastSearch.slice(0, CARDS_SHOWN), notShown: turn.lastSearch.slice(CARDS_SHOWN), stored: false };
  return null;
}
