import { readFile } from "node:fs/promises";

/**
 * One day of buy conversations, as the job reads them. The same shape whatever it is read from: the backend's database
 * (read only), a file, or an export served over HTTPS, so the rest of the job does not care where the day came from.
 */
export interface Day {
  /** The day, `2026-11-24`, in UTC. */
  day: string;
  conversations: Conversation[];
  messages: Message[];
  /** How many conversations the day held, and how many were left out as test traffic, by reason. */
  counts: { all: number; testMode: number; ownCompany: number; skippedCompany: number; skippedClient: number; skippedShopper: number; machine: number; read: number };
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
  products: { name: string; store: string | null; price: string | null }[];
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
  turn: { status: string | null; nextAction: string | null; declineCode: string | null; errorCode: string | null; tools: string[]; cart: boolean; ordered: boolean } | null;
}

/** The most rows one read takes, so a day of unexpected size never becomes a dump of the tables. */
const MOST_CONVERSATIONS = 5000;
const MOST_MESSAGES = 30000;
/** A follow-up counts up to this long after the day ends, so the last conversations of the day are read whole. */
const HOURS_AFTER = 12;

/**
 * The day's conversations with a reason on each one that is test traffic: a company's test mode (or no recorded mode),
 * a company the backend marks as Agentcard's own, a company, client or shopper on the skip lists, or a shopper who opened more conversations in the day than a person
 * does, which is a monitor or a benchmark.
 */
const DAY = `
  with day as (
    select c.id, c."userId", c."organizationId", c."clientId", c.sandbox, o.internal, count(*) over (partition by c."userId") as opened
      from "ChatConversation" c
      left join "Organization" o on o.id = c."organizationId"
     where c.kind = 'buy' and c."createdAt" >= $1 and c."createdAt" < $2)
  select id,
         case when sandbox is not false then 'testMode'
              when internal is true then 'ownCompany'
              when "organizationId" = any($3::text[]) then 'skippedCompany'
              when "clientId" = any($4::text[]) then 'skippedClient'
              when "userId" = any($5::text[]) then 'skippedShopper'
              when opened > $6::int then 'machine'
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
         case when m.meta ? 'turn' then jsonb_build_object(
           'status', m.meta->'turn'->>'status',
           'nextAction', m.meta->'turn'->>'next_action',
           'declineCode', m.meta->'turn'->>'decline_code',
           'errorCode', m.meta->'turn'->>'error_code',
           'tools', case when jsonb_typeof(m.meta->'turn'->'tools') = 'array' then m.meta->'turn'->'tools' else '[]'::jsonb end,
           'cart', jsonb_typeof(m.meta->'turn'->'cart') = 'object',
           'ordered', m.meta->'turn'->>'order_id' is not null) end as turn
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
  return !currency || currency === "USD" ? `$${amount}` : `${amount} ${String(currency)}`;
}

/**
 * Reads the day from the backend's Postgres with a login that can only read. Every statement runs in a read-only
 * transaction with a time limit, takes one day and has a row limit.
 */
async function fromDatabase(url: string, day: string, env: NodeJS.ProcessEnv): Promise<Day> {
  const list = (name: string) => (env[name] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const skip = [list("REAL_ASKS_SKIP_COMPANIES"), list("REAL_ASKS_SKIP_CLIENTS"), list("REAL_ASKS_SKIP_SHOPPERS"), Number(env.REAL_ASKS_MOST_PER_SHOPPER ?? 40)];
  const { default: pg } = await import("pg");
  // The backend's columns hold UTC without a zone, so the bounds go as plain UTC text and no driver shifts them.
  const utc = (hours: number) => new Date(Date.parse(`${day}T00:00:00Z`) + hours * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
  const [start, end, until] = [utc(0), utc(24), utc(24 + HOURS_AFTER)];
  // Through a tunnel the database answers on 127.0.0.1, where its certificate's name cannot match; the tunnel is the trusted path.
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: !local }, statement_timeout: 60_000 });
  await client.connect();
  try {
    await client.query("begin transaction read only");
    const counted = await client.query(COUNTS, [start, end, ...skip]);
    const conversations = await client.query(CONVERSATIONS, [start, end, ...skip]);
    const ids = conversations.rows.map((row) => row.id as string);
    const messages = await client.query(MESSAGES, [ids, until]);
    const checkouts = await client.query(CHECKOUTS, [ids, until]);
    await client.query("rollback");
    if (conversations.rows.length === MOST_CONVERSATIONS) console.warn(`The day holds more than ${MOST_CONVERSATIONS} conversations; only the first ${MOST_CONVERSATIONS} were read.`);
    const counts = { all: 0, testMode: 0, ownCompany: 0, skippedCompany: 0, skippedClient: 0, skippedShopper: 0, machine: 0, read: 0 };
    for (const row of counted.rows as { why: keyof typeof counts; n: number }[]) {
      counts[row.why] = row.n;
      counts.all += row.n;
    }
    return {
      day,
      counts,
      conversations: conversations.rows.map((row) => ({ ...row, products: (row.products as { name: string; store: string | null; cents: unknown; currency: unknown }[]).filter((product) => product.name).map((product) => ({ name: product.name, store: product.store, price: price(product.cents, product.currency) })) })),
      messages: messages.rows.map((row) => ({ ...row, at: utcText(row.at), tapped: row.tapped === true })),
      checkouts: checkouts.rows,
    };
  } finally {
    await client.end();
  }
}

/**
 * Reads the day from an export served over HTTPS: `GET <url>?day=2026-11-24` with a bearer token, answering a `Day` as
 * JSON with the test traffic already left out. No such export exists yet; this is the shape one would answer in.
 */
async function fromExport(url: string, token: string | undefined, day: string): Promise<Day> {
  const address = new URL(url);
  address.searchParams.set("day", day);
  const response = await fetch(address, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`the export answered ${response.status}`);
  return (await response.json()) as Day;
}

/** Where the job can read a day from, in the order it tries them, or null when none is set up. */
export function source(env: NodeJS.ProcessEnv = process.env): "file" | "export" | "database" | null {
  if (env.REAL_ASKS_FILE) return "file";
  if (env.REAL_ASKS_EXPORT_URL) return "export";
  if (env.REAL_ASKS_DATABASE_URL) return "database";
  return null;
}

export async function readDay(day: string, env: NodeJS.ProcessEnv = process.env): Promise<Day> {
  const from = source(env);
  if (from === "file") return JSON.parse(await readFile(env.REAL_ASKS_FILE!, "utf8")) as Day;
  if (from === "export") return fromExport(env.REAL_ASKS_EXPORT_URL!, env.REAL_ASKS_EXPORT_TOKEN, day);
  if (from === "database") return fromDatabase(env.REAL_ASKS_DATABASE_URL!, day, env);
  throw new Error("Nowhere to read conversations from: set REAL_ASKS_EXPORT_URL, REAL_ASKS_DATABASE_URL or REAL_ASKS_FILE.");
}
