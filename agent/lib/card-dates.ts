/**
 * When each card's booking starts, by the card's id, where Agentcard's answer names it.
 *
 * A card for a flight, a table, a class or a ticket is for one time, and an app shows that time on the card. Agentcard
 * names it in fields an app can read without parsing the card's words: a flight's first departure, an event's start, and
 * the time a table was searched for. A card whose answer names no time, such as a pair of shoes, is left out.
 */

/** The part of a product the buy tool hands an app that this file reads. */
export interface ProductWhen {
  id: string;
  ref: string | null;
  flight?: { legs: Array<{ departureAt: string | null }> };
}

/** The part of Agentcard's own answer this file reads: each product of the last search, as Agentcard sent it. */
interface RawAnswer {
  catalog?: { items?: Array<{ id?: unknown; ref?: unknown; startsAt?: unknown; starts_at?: unknown; reservation?: { searchedDatetime?: unknown } | null }> } | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/**
 * Each card's time, keyed by the id an app's card carries (`productId`, Agentcard's id with no link in it). `products`
 * are the answer's products as the buy tool hands them over, and `envelope` is Agentcard's own answer, which holds the
 * fields the tool does not copy onto a product.
 */
export function cardDates(products: readonly ProductWhen[] | undefined, envelope?: Record<string, unknown>): Record<string, string> {
  const dates: Record<string, string> = {};
  for (const product of products ?? []) {
    const departs = text(product.flight?.legs[0]?.departureAt);
    if (departs) dates[product.ref ?? product.id] = departs;
  }
  for (const item of (envelope as RawAnswer | undefined)?.catalog?.items ?? []) {
    const key = text(item.ref) ?? text(item.id);
    // An event's start at its venue, or the time a table was searched for.
    const when = text(item.startsAt) ?? text(item.starts_at) ?? text(item.reservation?.searchedDatetime);
    if (key && when && !(key in dates)) dates[key] = when;
  }
  return dates;
}
