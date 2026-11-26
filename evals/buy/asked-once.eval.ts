import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { cartStep, checkNothingOrdered, checkReached, logPath, sandboxCredentials, shop, SHOPPER, type Purchase } from "../lib/purchase.js";
import { SUPPLIERS, type StoreCase } from "../lib/stores.js";

/**
 * A shopper who has said what they want is not asked again, and is not shown a product that then cannot go in a cart.
 *
 * Each eval here is one way that went wrong in production in the week to 2026-11-26, and was then fixed in Agentcard's
 * backend. The shopper asks, picks a card and answers what the store asks, as in the cart evals (cart.eval.ts), and
 * the eval passes when, by fixed rules and no judge model:
 * - the product gets into a cart, at the store the shopper named, as the one line of that cart, with nothing ordered
 *   (the cart evals check its prices and its total, store by store);
 * - no reply says the thing that case used to say, such as "Want me to add that one?" to a shopper who had named the
 *   product, or "I couldn't add it in White" for a colour the store lists.
 *
 * The evals run with sandbox (test mode) credentials only, and skip themselves otherwise.
 */
interface AskedOnceCase {
  /** What used to happen, in the eval's name. */
  name: string;
  row: StoreCase;
  /** What no reply may say, and the check's message when one does. */
  never: RegExp;
  neverMeans: string;
  /** Which replies are read: all of them, or only those after the shopper picked a card. Before a pick, "Want me to add it?" can be a fair question. */
  read?: "after the pick";
  /** Earlier messages of the same chat, sent before the ask: a store the shopper only looked at. */
  messages?: string[];
  /**
   * Set for a store whose page often drops the product: the eval then passes once the store's own checkout has started
   * for the pick (it asks where to deliver), since the case is about getting that far.
   */
  until?: "the checkout starts";
  /** True when every question about the product must come before the delivery address is asked. */
  optionsBeforeAddress?: true;
}

const ASKS_AGAIN = /(want|would you like) me to (add|put)|(should|shall) i add|do you want (me to add|it from)|reply (with a )?yes|say yes and i'll (add|try)/i;
const COULD_NOT_ADD = /couldn't add|could not add|can't add|cannot add|haven't added/i;

const jadeYoga: StoreCase = { store: "jadeyoga.com", supplier: "shopify", kind: "goods", ask: "a Jade Harmony yoga mat from jadeyoga.com", at: /jade/i, product: /harmony/i, maxPrice: 130 };

const cases: AskedOnceCase[] = [
  {
    name: "a product named in full, with its store, is carted without a second question",
    row: { store: "hydroflask.com", supplier: "catalog", kind: "goods", ask: "Add one Hydro Flask Standard Mouth Stainless Steel Water Bottle from hydroflask.com and show the total", at: /hydro ?flask/i, product: /bottle/i, maxPrice: 60 },
    never: ASKS_AGAIN,
    neverMeans: "the shopper named the product and the store, so no reply asks whether to add it",
  },
  {
    name: "an answer to the store's own question carts the product",
    row: jadeYoga,
    never: ASKS_AGAIN,
    neverMeans: "the shopper answered the question they were asked, so no reply asks whether to add the product",
    read: "after the pick",
    optionsBeforeAddress: true,
  },
  {
    name: "an answer sent with the product's price still carts the product",
    // An app built on the Commerce SDK answers a store's question by sending the card's line again, price included.
    row: { ...jadeYoga, choiceAs: (value, picked) => `Add ${picked?.name ?? "the Jade Harmony Yoga Mat"}${picked?.price ? `, ${picked.price}` : ""} from JadeYoga to my cart, ${value}` },
    never: COULD_NOT_ADD,
    neverMeans: "a price in the shopper's answer is not a new quantity, so no reply says the product could not be added",
    read: "after the pick",
  },
  {
    name: "a colour the store lists is carted, whatever else the request says",
    row: { store: "brooklinen.com", supplier: "shopify", kind: "goods", ask: "a set of 2 white Super-Plush Turkish Cotton Bath Towels from brooklinen.com", at: /brooklinen/i, product: /towel/i, maxPrice: 160 },
    never: /couldn't add it in white|could not add it in white|default title/i,
    neverMeans: "White is a colour the store lists, so no reply says it could not be added in White or names the store's placeholder option",
  },
  {
    name: "a Shopify store listed without www is searched and bought at its own site",
    row: { store: "grivetoutdoors.com", supplier: "shopify", kind: "goods", ask: "a Dickies striped long sleeve cropped t-shirt for women from grivetoutdoors.com", at: /grivet/i, product: /striped/i, maxPrice: 60 },
    never: /failed before payment|did not reach the store/i,
    neverMeans: "the store's own site sells the product, so no reply says the checkout failed before payment",
    optionsBeforeAddress: true,
  },
  {
    name: "a card whose page address is longer than its title is the same product",
    row: { store: "Best Buy", supplier: "catalog", kind: "goods", ask: "a StarTech 6 ft flat high speed HDMI cable from Best Buy", at: /best ?buy/i, product: /hdmi/i, cards: "catalog", maxPrice: 60 },
    never: /another product|a different product/i,
    neverMeans: "the card's link opens that product, so no reply says it opened another product",
  },
  {
    name: "a card at a store in Canada is carted",
    // The CN Tower: a public landmark, never a person's address.
    row: { store: "canadiantire.ca", supplier: "catalog", kind: "goods", ask: "a 16 pack of Duracell Coppertop AA batteries from canadiantire.ca", at: /canadian ?tire/i, product: /duracell/i, maxPrice: 45, address: "290 Bremner Blvd, Toronto, ON M5V 3L9, Canada" },
    never: /no offer|isn't available to order there|not available to order there/i,
    neverMeans: "the store sells the product in Canada, so no reply says the catalog has no offer there",
    until: "the checkout starts",
  },
  {
    name: "a store named in this message is where the product is bought, whatever store an earlier message named",
    messages: ["show me notebooks at muji.us"],
    row: { store: "hydroflask.com", supplier: "catalog", kind: "goods", ask: "a Hydro Flask Standard Mouth stainless steel water bottle from hydroflask.com, add it to my cart", at: /hydro ?flask/i, product: /bottle/i, maxPrice: 60 },
    never: /muji/i,
    neverMeans: "the shopper asked at hydroflask.com now, so no reply holds the purchase to the store they looked at before",
    read: "after the pick",
  },
];

/** Every reply of the chat the case reads, Agentcard's and the agent's own, each with the message it answered. */
function repliesRead(purchase: Purchase, read: AskedOnceCase["read"]): { said: string; reply: string }[] {
  const picked = purchase.picked ? purchase.steps.findIndex((step) => step.said.includes(purchase.picked!.name)) : -1;
  const steps = read === "after the pick" ? purchase.steps.slice(Math.max(picked, 0)) : purchase.steps;
  return steps.flatMap((step) => [step.answer?.reply ?? "", step.turn.reply ?? ""].filter(Boolean).map((reply) => ({ said: step.said, reply })));
}

export default cases.map((one) =>
  defineEval({
    description: `asked once: ${one.name}`,
    tags: ["asked-once", one.row.kind],
    metadata: { ask: one.row.ask, store: one.row.store, supplier: SUPPLIERS[one.row.supplier], ...(one.messages ? { messages: [...one.messages, one.row.ask] } : {}) },
    // A store's own checkout can take a few minutes to price a cart.
    timeoutMs: 720_000,
    async test(t) {
      if (!(await sandboxCredentials())) t.skip("These evals run with sandbox (test mode) credentials only.");

      let session: Parameters<typeof shop>[4];
      for (const message of one.messages ?? []) session = (session ? await session.send(message) : await t.send(message)).session;
      const purchase = await shop(t, one.row, "cart", 480_000, session);
      t.succeeded();
      checkNothingOrdered(t, purchase);

      const broke = repliesRead(purchase, one.read).find(({ reply }) => one.never.test(reply));
      t.check(
        broke ?? null,
        satisfies((found: typeof broke | null) => found === null, `${one.neverMeans}${broke ? ` (after "${broke.said.slice(0, 80)}" it said: ${broke.reply.replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").slice(0, 240)})` : ""}`),
      ).label("never-asks-again");

      if (one.optionsBeforeAddress) {
        // Once the shopper has given the address, the store has no question left about the product itself.
        const address = one.row.address ?? SHOPPER.address;
        const given = purchase.steps.findIndex((step) => step.said === address);
        const late = given < 0 ? undefined : purchase.steps.slice(given).find((step) => (step.answer?.choice?.groups.length ?? 0) > 0);
        t.check(
          late ?? null,
          satisfies((found: typeof late | null) => found === null, `a size or a colour is asked before the delivery address${late ? ` (after the address it asked: ${(late.answer?.reply ?? "").replace(/\s+/g, " ").slice(0, 200)})` : ""}`),
        ).label("options-before-address");
      }

      const step = cartStep(purchase);
      if (one.until === "the checkout starts") {
        const started = purchase.steps.some((each) => Boolean(each.answer?.cart) || each.answer?.next_action === "shipping_details");
        t.check(started, satisfies((did: boolean) => did, `the store's own checkout starts for the pick${purchase.stopped ? ` (${purchase.stopped})` : ""}`)).label("checkout-starts");
        return;
      }
      if (!step && !purchase.stopped) purchase.stopped = `the shopper was handed a ${purchase.handed ?? "next"} step before any cart was shown. Agentcard said: ${(purchase.steps.at(-1)?.answer?.reply ?? "").replace(/https?:\/\/\S+/g, "(a link)").replace(/\s+/g, " ").slice(0, 220)}`;
      if (!checkReached(t, purchase, "product-in-cart", "the product gets into a cart") || !step) return;
      logPath(t, one.row, step.snapshot?.carts.at(-1)?.merchant);
      const cart = step.answer!.cart!;
      const lines = cart.items.map((item) => `${item.qty} x ${item.name.slice(0, 70)}`).join("; ");
      t.check(cart.store, satisfies((store: string) => one.row.at!.test(store), `the cart is at ${one.row.store} (it is at ${cart.store})`)).label("cart-at-named-store");
      t.check(cart.items, satisfies((items: typeof cart.items) => items.length === 1 && items[0]!.qty === 1, `the cart holds one line, one of it (it holds: ${lines})`)).label("cart-holds-one-line");
      const picked = purchase.picked;
      const line = cart.items[0];
      const same = Boolean(line) && ((picked?.id != null && (line!.product_id === picked.id || (line!.other_product_ids ?? []).includes(picked.id))) || one.row.product.test(line!.name));
      t.check(same, satisfies((is: boolean) => is, `the cart's line is the product the shopper asked for (in the cart: ${lines})`)).label("cart-holds-the-pick");
    },
  }),
);
