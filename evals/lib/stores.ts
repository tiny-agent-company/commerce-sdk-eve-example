/**
 * Every store the cart and checkout evals cover, once for each supplier that can serve it. Each row becomes two evals:
 * one in buy/cart.eval.ts ("the product gets into the cart") and one in buy/checkout.eval.ts ("the purchase gets as far
 * as the checkout step"). To add a store, add a row.
 *
 * WHO SERVES A STORE
 *
 * Agentcard reaches a store through one of several suppliers, and a shopper never hears which. An eval can tell them
 * apart from fields meant for code, and for the big retailers it can choose between two of them:
 *
 * - `retail`: Agentcard's retail ordering supplier, which searches the big US retailers and places the order for the
 *   shopper. Its product cards open a page on the store's own website, and its cart is priced as an estimate until the
 *   order goes in.
 * - `catalog`: Agentcard's product catalog supplier, which lists products at about 5,000 stores. Its cards open the
 *   catalog's own link. The purchase then runs through the store's own checkout, which Agentcard fills in with a hosted
 *   browser, so the cart only exists once the store has priced it, tax and shipping included.
 *
 * One search at a big retailer often shows cards from both. Which one answers is decided by the card the shopper picks,
 * so a `retail` row picks a card that opens the store's own page and a `catalog` row picks a card from the catalog.
 * A row whose supplier shows no card for the store fails with that as its reason.
 *
 * The other suppliers are chosen by Agentcard's code, never by the ask, so each of these is covered once, as whoever
 * answers: a Shopify store's own catalog, a brand's own site, eBay's used listings, the specialty coffee index, the food
 * delivery service, and the booking suppliers for flights, hotels, cars, tables, classes and tickets. Each eval logs
 * which path answered.
 *
 * There are countless Shopify stores, so one stands for all of them.
 */

/** A date a few days out, as a shopper would type it, so no row ever asks for a day in the past. */
export function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** The name of the month a number of days out, for an ask about a game some weeks away. */
function monthFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", { month: "long" });
}

/** How the suppliers read in an eval's name and log. */
export const SUPPLIERS = {
  retail: "retail ordering supplier",
  catalog: "product catalog supplier",
  shopify: "the store's own Shopify catalog",
  "own site": "the store's own site",
  "used listings": "eBay's used listings",
  coffee: "specialty coffee index",
  "food delivery": "food delivery service",
  flights: "flight supplier",
  hotels: "hotel supplier",
  cars: "rental car supplier",
  tables: "restaurant booking supplier",
  classes: "class booking supplier",
  tickets: "resale ticket supplier",
  events: "events supplier",
  rides: "ride service",
} as const;

export type Supplier = keyof typeof SUPPLIERS;

export interface StoreCase {
  /** The store, as the eval's name shows it. */
  store: string;
  supplier: Supplier;
  /**
   * `goods` ship to an address. `food` is delivered from a nearby store. A `booking` is a flight, a room, a car, a table,
   * a class or a ticket: its "cart" is the booking held with its price, and an eval never says yes to one.
   */
  kind: "goods" | "food" | "booking";
  /** The shopper's first message: one specific, cheap product that is always in stock. */
  ask: string;
  /** The cart must be at this store. Left out for a booking, whose cart is at the airline, the hotel or the venue. */
  at?: RegExp;
  /** What the card the shopper picks, and the line in the cart, must be. */
  product: RegExp;
  /** Which cards to pick from, for a store two suppliers serve: ones that open the store's own page, or the catalog's. */
  cards?: "store page" | "catalog";
  /** The most the picked card may cost, in dollars, so an eval never walks an expensive product to a checkout. */
  maxPrice?: number;
  /** How many the shopper asks for, when it is not one. */
  quantity?: number;
  /** True for a booking that costs nothing, such as a restaurant table: its line shows no price. */
  free?: true;
  /** Set when neither eval can run safely or at all: the eval is skipped with this as the reason. */
  skip?: string;
  /** Set when the cart can be checked but the checkout step cannot be reached safely: only the checkout eval is skipped. */
  skipCheckout?: string;
}

/** A big US retailer, asked for once: the shopper picks the first card that is the product, whichever supplier it is from. */
const retailer = (store: string, at: RegExp, ask: string, product: RegExp, maxPrice = 60): StoreCase => ({ store, supplier: "retail", kind: "goods", ask, at, product, maxPrice });

/** A retailer the retail ordering supplier no longer lists: the catalog shows its products, and its own checkout sells them. */
const ownCheckout = (store: string, at: RegExp, ask: string, product: RegExp, maxPrice = 60): StoreCase => ({ store, supplier: "catalog", kind: "goods", ask, at, product, maxPrice });

/** The same retailer a second time, picking only a card from the product catalog supplier, where that takes another path. */
const fromCatalog = (row: StoreCase): StoreCase => ({ ...row, supplier: "catalog", cards: "catalog" });

const amazon = retailer("Amazon", /amazon/i, "an 8-pack of Amazon Basics AA batteries from Amazon", /\bAA\b/i);
const target = retailer("Target", /target/i, "a box of Crayola 24 count crayons from Target", /crayon/i);
const gap = retailer("Gap", /gap/i, "a black cotton crewneck t-shirt for men in size medium from Gap", /t-?shirt|tee/i);
const uniqlo = retailer("Uniqlo", /uniqlo/i, "a white AIRism cotton crew neck t-shirt for men in size medium from Uniqlo", /airism/i);
const ace = retailer("Ace Hardware", /ace/i, "a Stanley 16 ounce claw hammer from Ace Hardware", /hammer/i);
const ebay = retailer("eBay", /ebay/i, "a new stainless steel water bottle on eBay, Buy It Now", /bottle/i);
const tiktok = retailer("TikTok Shop", /tiktok/i, "a stainless steel water bottle from TikTok Shop", /bottle|tumbler/i);
const mcmaster = retailer("McMaster-Carr", /mcmaster/i, "a pack of M6 stainless steel socket head screws from McMaster-Carr", /screw/i);

const retailers: StoreCase[] = [
  amazon,
  retailer("Walmart", /walmart/i, "a bottle of Great Value dish soap from Walmart", /dish/i),
  target,
  fromCatalog(target),
  retailer("Best Buy", /best ?buy/i, "a 6 ft HDMI cable from Best Buy", /hdmi/i),
  retailer("The Home Depot", /home ?depot/i, "a pair of FIRM GRIP large leather work gloves from Home Depot", /glove/i),
  retailer("Lowe's", /lowe/i, "a CRAFTSMAN 16 oz fiberglass claw hammer from Lowe's", /hammer/i),
  retailer("Macy's", /macy/i, "an OXO Good Grips swivel peeler from Macy's", /peeler/i),
  retailer("Wayfair", /wayfair/i, "a black metal mesh desk organizer from Wayfair", /organizer/i),
  ownCheckout("Staples", /staples/i, "a pack of blue ballpoint pens from Staples", /pen/i),
  ownCheckout("Kohl's", /kohl/i, "a stainless steel water bottle from Kohl's", /bottle|tumbler/i),
  ownCheckout("B&H", /b ?& ?h|bhphoto/i, "a 64GB SD card from B&H", /64 ?gb/i),
  gap,
  fromCatalog(gap),
  retailer("Barnes & Noble", /barnes/i, "a paperback copy of The Hobbit from Barnes & Noble", /hobbit/i),
  retailer("Sephora", /sephora/i, "a 30 ml bottle of The Ordinary Niacinamide 10% + Zinc 1% serum from Sephora", /niacinamide/i),
  retailer("Parts Town", /parts ?town/i, "a Taylor 5932 oven thermometer from Parts Town", /thermometer|5932/i),
  retailer("1-800-Flowers", /flowers/i, "a Two Dozen Red Roses bouquet from 1-800-Flowers", /roses/i, 120),
  retailer("Grainger", /grainger/i, "a pair of 3M safety glasses with clear lenses from Grainger", /glasses|eyewear/i),
  retailer("Chewy", /chewy/i, "a 12 ounce bag of Greenies original regular dog dental treats from Chewy", /greenies/i),
  uniqlo,
  fromCatalog(uniqlo),
  retailer("Pokémon Center", /pok[eé]mon/i, "a Pikachu plush from Pokémon Center", /pikachu/i),
  retailer("Zazzle", /zazzle/i, "an 11 ounce floral ceramic mug from Zazzle", /mug/i),
  ace,
  fromCatalog(ace),
  ebay,
  fromCatalog(ebay),
  tiktok,
  fromCatalog(tiktok),
  mcmaster,
  fromCatalog(mcmaster),
];

/** Stores reached another way. The supplier here is chosen by Agentcard's code, so each store is covered once. */
const otherStores: StoreCase[] = [
  // The one Shopify store that stands for all of them.
  { store: "jadeyoga.com (a Shopify store)", supplier: "shopify", kind: "goods", ask: "a Jade Harmony yoga mat from jadeyoga.com", at: /jade/i, product: /harmony/i, maxPrice: 130 },
  { store: "hydroflask.com", supplier: "catalog", kind: "goods", ask: "a Hydro Flask Standard Mouth stainless steel water bottle from hydroflask.com", at: /hydro ?flask/i, product: /bottle/i, cards: "catalog", maxPrice: 60 },
  {
    store: "AutoZone",
    supplier: "catalog",
    kind: "goods",
    ask: "a Rain-X 20 inch wiper blade from autozone.com",
    at: /autozone/i,
    product: /wiper/i,
    maxPrice: 60,
    skip: "AutoZone's checkout refuses the shopper's placeholder phone number, which is from the range reserved for fiction, and an eval must not give a real person's number.",
  },
  { store: "Allbirds (a brand's own site)", supplier: "own site", kind: "goods", ask: "Allbirds Tree Runners, men's size 10, from allbirds.com", at: /allbirds/i, product: /tree runner/i, maxPrice: 160 },
  {
    store: "Costco (a store's own brand)",
    supplier: "own site",
    kind: "goods",
    ask: "Kirkland Signature extra virgin olive oil from Costco",
    at: /costco/i,
    product: /olive oil/i,
    maxPrice: 60,
    skip: "Costco's checkout needs the shopper's own Costco account before it builds a cart. An eval has no account to sign in to, and must not use a real one.",
  },
  { store: "eBay, a used listing", supplier: "used listings", kind: "goods", ask: "a used Canon AE-1 film camera on eBay", at: /ebay/i, product: /canon/i, maxPrice: 250 },
  { store: "a specialty coffee roaster", supplier: "coffee", kind: "goods", ask: "a bag of specialty whole bean coffee from Onyx Coffee Lab's own site", product: /coffee|onyx/i, maxPrice: 60 },
  {
    store: "Amazon UK",
    supplier: "retail",
    kind: "goods",
    ask: "a pack of PG Tips tea bags from amazon.co.uk",
    at: /amazon/i,
    product: /pg tips/i,
    skip: "Amazon's stores outside the US are switched off in Agentcard's code, so nothing there can be put in a cart yet.",
  },
];

/** Food and groceries, delivered by the food delivery service to the evals' placeholder address. */
const food: StoreCase[] = [
  { store: "Taco Bell on DoorDash", supplier: "food delivery", kind: "food", ask: "one Crunchy Taco from Taco Bell on DoorDash", at: /taco bell|doordash/i, product: /crunchy taco(?! supreme)/i, maxPrice: 15 },
  { store: "a grocery store on DoorDash", supplier: "food delivery", kind: "food", ask: "a bunch of bananas from Safeway, delivered today by DoorDash", at: /safeway|doordash/i, product: /banana/i, maxPrice: 15 },
];

/** Bookings. The "cart" is the booking held with its price, and no eval ever says yes to one. */
const bookings: StoreCase[] = [
  { store: "a flight", supplier: "flights", kind: "booking", ask: `a one-way flight from San Francisco to New York JFK on ${dayFromNow(21)}, economy, one adult`, product: /SFO|San Francisco|JFK/i, maxPrice: 900 },
  { store: "a hotel room", supplier: "hotels", kind: "booking", ask: `a hotel in downtown Chicago for two nights from ${dayFromNow(28)}, under $250 a night, for one adult`, product: /./, maxPrice: 600 },
  { store: "a rental car", supplier: "cars", kind: "booking", ask: `a rental car at LAX for three days from ${dayFromNow(21)}`, product: /./, maxPrice: 600 },
  { store: "a restaurant table", supplier: "tables", kind: "booking", free: true, ask: `a table for two at an Italian restaurant in San Francisco on ${dayFromNow(7)} at 7pm`, product: /./ },
  { store: "a fitness class", supplier: "classes", kind: "booking", ask: `a yoga class in Austin on ${dayFromNow(3)} morning`, product: /./, maxPrice: 60 },
  { store: "resale game tickets", supplier: "tickets", kind: "booking", ask: `two tickets to a New York Knicks home game in ${monthFromNow(45)}`, product: /knicks/i, quantity: 2, maxPrice: 1200 },
  { store: "a live event", supplier: "events", kind: "booking", ask: "a ticket to a comedy show in New York City this weekend", product: /./, maxPrice: 150 },
  {
    store: "an Uber ride",
    supplier: "rides",
    kind: "booking",
    ask: "an Uber from the Ferry Building in San Francisco to SFO airport",
    product: /./,
    skip: "A ride is quoted and booked on the rider's own Uber account, and the first answer is a sign-in to that account. An eval has no account to sign in to, and must not use a real one.",
  },
];

export const STORES: StoreCase[] = [...retailers, ...otherStores, ...food, ...bookings];

/**
 * In Agentcard's list of merchants, but not covered, with the reason. Nothing here can be put in a cart, so there is
 * nothing for these evals to check yet.
 */
export const NOT_COVERED: { store: string; why: string }[] = [
  { store: "Uber Eats", why: "not built: a placeholder with no way to shop yet" },
  { store: "Rappi", why: "not built: a placeholder with no way to shop yet" },
  { store: "Rinse", why: "not built: a placeholder with no way to shop yet" },
  { store: "TaskRabbit", why: "not built: a placeholder with no way to shop yet" },
  { store: "Walgreens", why: "in the retail store list, but no search can find a product there" },
  { store: "Apple", why: "in the retail store list, but no search can find a product there" },
  { store: "Ticketmaster", why: "search only: it shows events and has no checkout" },
  { store: "Locale", why: "manages a meal subscription on the shopper's own account, with no cart to build" },
  { store: "Crate & Barrel and other stores Agentcard cannot pay at", why: "refused by design before any cart" },
];
