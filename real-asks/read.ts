import { readFileSync } from "node:fs";

/**
 * One day of buy conversations, as the job reads them from the backend's database with a login that can only read.
 */
export interface Day {
  /** The day, `2026-11-24`, in UTC. */
  day: string;
  conversations: Conversation[];
  messages: Message[];
  /** How many conversations the day held, and how many were left out as test traffic, by reason. */
  counts: { all: number; testMode: number; ownCompany: number; skippedCompany: number; skippedClient: number; skippedShopper: number; read: number };
  /** Checkout attempts that stopped short, by conversation. */
  checkouts: { conversation: string; stage: string; stopped: string | null }[];
}

export interface Conversation {
  id: string;
  shopper: string;
  company: string | null;
  client: string | null;
  /** True for a company's test mode, false for live, null when no record says. */
  sandbox: boolean | null;
  /** The shopper message the saved products answer, or null when the conversation holds none. */
  productsFor: string | null;
  /** The products of the conversation's last search: only the last search is kept, each new one replaces it. */
  products: Product[];
}

/** A product as a card states it: a name, a store and a price. */
export interface Product {
  name: string;
  store: string | null;
  price: string | null;
}

export interface Message {
  id: string;
  conversation: string;
  role: "visitor" | "agent";
  body: string;
  at: string;
  /** True when the shopper tapped a card or a button instead of typing. */
  tapped: boolean;
  /** What the caller was handed for the turn, on the agent's rows only. */
  turn: {
    status: string | null;
    nextAction: string | null;
    declineCode: string | null;
    errorCode: string | null;
    tools: string[];
    cart: boolean;
    ordered: boolean;
    /** The product cards this answer showed, when the backend stored them with the turn; null when it did not. */
    cards?: Product[] | null;
  } | null;
}

/** The most rows one read takes, so a day of unexpected size never becomes a dump of the tables. */
const MOST_CONVERSATIONS = 5000;
const MOST_MESSAGES = 30000;
/** A follow-up counts up to this long after the day ends, so the last conversations of the day are read whole. */
const HOURS_AFTER = 12;

/**
 * The day's conversations with a reason on each one that is test traffic: a company's test mode (or no recorded mode),
 * a company the backend marks as Agentcard's own (unless it is on the keep list), or a company, client or shopper on
 * the skip lists. Automated callers are named by their exact ids on those lists and never guessed from how much they
 * send: a shopper is not a machine for being busy.
 */
const DAY = `
  with day as (
    select c.id, c."userId", c."organizationId", c."clientId", c.sandbox, o.internal
      from "ChatConversation" c
      left join "Organization" o on o.id = c."organizationId"
     where c.kind = 'buy' and c."createdAt" >= $1 and c."createdAt" < $2)
  select id,
         case when sandbox is not false then 'testMode'
              when internal is true and not ("organizationId" = any($6::text[])) then 'ownCompany'
              when "organizationId" = any($3::text[]) then 'skippedCompany'
              when "clientId" = any($4::text[]) then 'skippedClient'
              when "userId" = any($5::text[]) then 'skippedShopper'
              else 'read' end as why
    from day`;

const COUNTS = `select why, count(*)::int as n from (${DAY}) as marked group by why`;

const CONVERSATIONS = `
  select c.id, c."userId" as shopper, c."organizationId" as company, c."clientId" as client, c.sandbox,
         c."buyState"->>'itemsTurn' as "productsFor",
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', left(e.item->>'name', 300),
                    'store', left(coalesce(case when jsonb_typeof(e.item->'store') = 'object' then e.item->'store'->>'name' else e.item->>'store' end, e.item->>'seller'), 120),
                    'cents', e.item->'priceCents',
                    'currency', e.item->>'currency') order by e.place), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(c."buyState"->'items') = 'array' then c."buyState"->'items' else '[]'::jsonb end)
                 with ordinality as e(item, place)
           where e.place <= 30) as products
    from "ChatConversation" c
   where c.id in (select id from (${DAY}) as marked where why = 'read')
   order by c."createdAt"
   limit ${MOST_CONVERSATIONS}`;

const MESSAGES = `
  select m.id, m."conversationId" as conversation, m.role, left(m.body, 2000) as body, m."createdAt" as at,
         (m.meta ? 'shopperChoice') as tapped,
         case when m.meta ? 'turn' or m.meta ? 'shown_cards' then jsonb_build_object(
           'status', m.meta->'turn'->>'status',
           'nextAction', m.meta->'turn'->>'next_action',
           'declineCode', m.meta->'turn'->>'decline_code',
           'errorCode', m.meta->'turn'->>'error_code',
           'tools', case when jsonb_typeof(m.meta->'turn'->'tools') = 'array' then m.meta->'turn'->'tools' else '[]'::jsonb end,
           'cart', jsonb_typeof(m.meta->'turn'->'cart') = 'object',
           'ordered', m.meta->'turn'->>'order_id' is not null,
           'cards', coalesce(case when jsonb_typeof(m.meta->'shown_cards'->'cards') = 'array' and jsonb_array_length(m.meta->'shown_cards'->'cards') <= 60 then m.meta->'shown_cards'->'cards' end, ${['$3::text', "'cards'", "'shown_cards'", "'cards_shown'"].map((key) => `case when jsonb_typeof(m.meta->'turn'->${key}) = 'array' and jsonb_array_length(m.meta->'turn'->${key}) <= 60 then m.meta->'turn'->${key} end`).join(", ")})) end as turn
    from "ChatMessage" m
   where m."conversationId" = any($1::text[]) and m."createdAt" < $2
   order by m."conversationId", m."createdAt", m.id
   limit ${MOST_MESSAGES}`;

const CHECKOUTS = `
  select a."conversationId" as conversation, a."furthestStage"::text as stage, a."stopReason" as stopped
    from commerce."PurchaseAttempt" a
   where a.source = 'live' and a."conversationId" = any($1::text[]) and a."createdAt" < $2
   limit 5000`;

/** A timestamp the database holds as UTC without a zone, which the driver hands back as if it were local time. */
function utcText(at: Date): string {
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString();
}

function price(cents: unknown, currency: unknown): string | null {
  if (typeof cents !== "number") return null;
  const amount = (cents / 100).toFixed(2);
  return !currency || String(currency).toUpperCase() === "USD" ? `$${amount}` : `${amount} ${String(currency).toUpperCase()}`;
}

/**
 * The cards a turn stored, read without trusting their shape. The backend stores them on the reply's message as
 * `meta.shown_cards.cards` (since 2026-11-26); older field names under `meta.turn` are still read in case it moves.
 * A card needs a name (`name` or `title`); its store may be a word or an object with a name; its price may be text or a
 * number of cents. Anything that is not a list of such cards reads as "not stored", and the job falls back to its guess
 * (cards.ts).
 */
export function readCards(stored: unknown): Product[] | null {
  if (!Array.isArray(stored)) return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);
  const cards: Product[] = [];
  for (const item of stored) {
    if (!item || typeof item !== "object") return null;
    const card = item as Record<string, unknown>;
    const name = text(card.name) ?? text(card.title);
    if (!name) return null;
    const store = card.store && typeof card.store === "object" ? text((card.store as Record<string, unknown>).name) : text(card.store);
    const cents = [card.priceCents, card.price_cents].find((value) => typeof value === "number");
    const priced = text(card.price) ?? price(cents, card.currency);
    cards.push({ name, store: store ?? text(card.merchant_name) ?? text(card.merchant) ?? text(card.seller), price: priced && card.price_from === true ? `from ${priced}` : priced });
  }
  return cards;
}

/** How the job reaches the database: one address, or the usual PG* variables, and never anything from a file in the repository. */
function connection(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const url = env.REAL_ASKS_DATABASE_URL;
  const host = url ? new URL(url).hostname : (env.PGHOST ?? "");
  // The database's certificate is checked against the authority's file when one is given. Without it the link is still
  // encrypted but the name is not checked, which is what a tunnel on 127.0.0.1 needs and what `sslmode=require` means.
  const ssl = env.REAL_ASKS_DATABASE_CA ? { ca: readFileSync(env.REAL_ASKS_DATABASE_CA, "utf8"), rejectUnauthorized: !/^(127\.0\.0\.1|localhost)$/.test(host) } : { rejectUnauthorized: false };
  // With no address, the driver reads PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD itself.
  return { ...(url ? { connectionString: url.replace(/[?&]sslmode=[^&]*/, "") } : {}), ssl, statement_timeout: 60_000 };
}

/**
 * Reads the day from the backend's Postgres with a login that can only read. Every statement runs in a read-only
 * transaction with a time limit, takes one day and has a row limit.
 */
async function fromDatabase(day: string, env: NodeJS.ProcessEnv): Promise<Day> {
  const list = (name: string) => (env[name] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const skip = [list("REAL_ASKS_SKIP_COMPANIES"), list("REAL_ASKS_SKIP_CLIENTS"), list("REAL_ASKS_SKIP_SHOPPERS"), list("REAL_ASKS_KEEP_COMPANIES")];
  const { default: pg } = await import("pg");
  // The backend's columns hold UTC without a zone, so the bounds go as plain UTC text and no driver shifts them.
  const utc = (hours: number) => new Date(Date.parse(`${day}T00:00:00Z`) + hours * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
  const [start, end, until] = [utc(0), utc(24), utc(24 + HOURS_AFTER)];
  const client = new pg.Client(connection(env));
  await client.connect();
  try {
    await client.query("begin transaction read only");
    const counted = await client.query(COUNTS, [start, end, ...skip]);
    const conversations = await client.query(CONVERSATIONS, [start, end, ...skip]);
    const ids = conversations.rows.map((row) => row.id as string);
    const messages = await client.query(MESSAGES, [ids, until, env.REAL_ASKS_CARDS_FIELD || "cards"]);
    const checkouts = await client.query(CHECKOUTS, [ids, until]);
    await client.query("rollback");
    if (conversations.rows.length === MOST_CONVERSATIONS) console.warn(`The day holds more than ${MOST_CONVERSATIONS} conversations; only the first ${MOST_CONVERSATIONS} were read.`);
    const counts = { all: 0, testMode: 0, ownCompany: 0, skippedCompany: 0, skippedClient: 0, skippedShopper: 0, read: 0 };
    for (const row of counted.rows as { why: keyof typeof counts; n: number }[]) {
      counts[row.why] = row.n;
      counts.all += row.n;
    }
    return {
      day,
      counts,
      conversations: conversations.rows.map((row) => ({ ...row, products: (row.products as { name: string; store: string | null; cents: unknown; currency: unknown }[]).filter((product) => product.name).map((product) => ({ name: product.name, store: product.store, price: price(product.cents, product.currency) })) })),
      messages: messages.rows.map((row) => ({ ...row, at: utcText(row.at), tapped: row.tapped === true, turn: row.turn ? { ...row.turn, cards: readCards(row.turn.cards) } : null })),
      checkouts: checkouts.rows,
    };
  } finally {
    await client.end();
  }
}

/** Where the job can read a day from, in the order it tries them, or null when none is set up. */
export function source(env: NodeJS.ProcessEnv = process.env): "database" | null {
  if (env.REAL_ASKS_DATABASE_URL || env.PGHOST) return "database";
  return null;
}

export async function readDay(day: string, env: NodeJS.ProcessEnv = process.env): Promise<Day> {
  const from = source(env);
  if (from === "database") return fromDatabase(day, env);
  throw new Error("Nowhere to read conversations from: set REAL_ASKS_DATABASE_URL, or PGHOST with the other PG variables.");
}
