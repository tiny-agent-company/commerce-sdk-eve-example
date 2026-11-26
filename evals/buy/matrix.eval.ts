import { defineEval } from "eve/evals";
import { checkAnswer, type Expectation } from "../lib/buy.js";

/**
 * The coverage matrix: one shopper message per case, spread over four things the buy tool's answers vary by.
 *
 * - `store`: a named store, one per store the buy tool lists, and one per kind of store it reaches another way.
 * - `kind`: a kind of ask the searches in search.eval.ts do not hold yet.
 * - `vertical`: what is being bought when it is not a product shipped to a door: food, travel, tickets, services.
 * - `locale`: another language, size system or country. Budgets are in US dollars only for now.
 *
 * The first tag of each case names its group and the second its value, so `npm run eval -- --tag store` runs one
 * group. Every case is graded the same way as a search (lib/buy.ts).
 */
type Case = Expectation & { group: "store" | "kind" | "vertical" | "locale"; name: string };

const one = (what: string, ...must: string[]) => [{ what, must }];

/** A date a few days out, as a shopper would type it, so no case ever asks for a day in the past. */
function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const stores: Case[] = [
  { group: "store", name: "Amazon", ask: "a 6 quart Instant Pot from Amazon", store: /amazon/i, wants: one("Instant Pot", "an Instant Pot brand multi-cooker", "6 quart") },
  { group: "store", name: "Walmart", ask: "Crest toothpaste from Walmart", store: /walmart/i, wants: one("Crest toothpaste", "toothpaste", "Crest brand") },
  { group: "store", name: "Target", ask: "a queen size white duvet cover from Target", store: /target/i, wants: one("duvet cover", "a duvet cover", "queen size", "white") },
  { group: "store", name: "Best Buy", ask: "a 55 inch 4K TV from Best Buy under $500", store: /best ?buy/i, maxPrice: 500, wants: one("TV", "a television", "55 inch", "4K", "costs under $500") },
  { group: "store", name: "The Home Depot", ask: "a DeWalt cordless drill from Home Depot", store: /home depot/i, wants: one("cordless drill", "a drill or drill kit", "DeWalt brand", "cordless") },
  { group: "store", name: "Lowe's", ask: "a 6 foot fiberglass step ladder at Lowe's", store: /lowe/i, wants: one("step ladder", "a step ladder", "6 foot", "fiberglass") },
  { group: "store", name: "Macy's", ask: "a men's navy blazer from Macy's", store: /macy/i, wants: one("blazer", "a blazer or sport coat", "for men", "navy") },
  { group: "store", name: "Wayfair", ask: "a mid-century modern nightstand from Wayfair", store: /wayfair/i, wants: one("nightstand", "a nightstand or bedside table") },
  { group: "store", name: "Staples", ask: "a case of letter size printer paper from Staples", store: /staples/i, wants: one("printer paper", "copy or printer paper", "letter size, 8.5 x 11") },
  { group: "store", name: "Kohl's", ask: "women's Levi's 501 jeans from Kohl's", store: /kohl/i, wants: one("Levi's 501 jeans", "jeans", "Levi's brand", "the 501 style", "for women") },
  { group: "store", name: "B&H", ask: "a 64GB SD card from B&H", store: /b ?& ?h|bhphoto/i, wants: one("SD card", "an SD or microSD memory card", "64GB") },
  { group: "store", name: "Gap", ask: "a kids' hoodie from Gap", store: /gap/i, wants: one("kids' hoodie", "a hoodie or hooded sweatshirt", "for kids") },
  { group: "store", name: "Barnes & Noble", ask: "the hardcover of Atomic Habits from Barnes & Noble", store: /barnes/i, wants: one("Atomic Habits", "the book Atomic Habits by James Clear", "hardcover") },
  { group: "store", name: "Sephora", ask: "a Rare Beauty liquid blush from Sephora", store: /sephora/i, wants: one("Rare Beauty blush", "a blush", "Rare Beauty brand") },
  { group: "store", name: "Chewy", ask: "a big bag of Purina Pro Plan dog food from Chewy", store: /chewy/i, wants: one("dog food", "dry dog food", "Purina Pro Plan") },
  { group: "store", name: "Uniqlo", ask: "a men's ultra light down jacket from Uniqlo", store: /uniqlo/i, wants: one("down jacket", "a down jacket", "for men") },
  { group: "store", name: "Ace Hardware", ask: "a Weber charcoal grill from Ace Hardware", store: /ace/i, wants: one("charcoal grill", "a grill", "Weber brand", "charcoal, not gas") },
  { group: "store", name: "1-800-Flowers", ask: "a dozen red roses from 1-800-Flowers", store: /flowers/i, wants: one("red roses", "roses", "red") },
  { group: "store", name: "Pokémon Center", ask: "a Pikachu plush from Pokémon Center", store: /pok[eé]mon/i, wants: one("Pikachu plush", "a plush toy", "Pikachu") },
  { group: "store", name: "Grainger", ask: "large nitrile gloves from Grainger", store: /grainger/i, wants: one("nitrile gloves", "disposable gloves", "nitrile", "size large") },
  { group: "store", name: "eBay, used", ask: "a used Canon AE-1 film camera on eBay", store: /ebay/i, wants: one("Canon AE-1", "a Canon AE-1 or AE-1 Program film camera, not only a lens or a part") },
  { group: "store", name: "AutoZone", ask: "wiper blades for a 2018 Honda Civic from AutoZone", store: /autozone/i, wants: one("wiper blades", "windshield wiper blades") },
  { group: "store", name: "a brand's own store", ask: "Allbirds Wool Runners, men's size 10", wants: one("Allbirds Wool Runners", "Allbirds brand", "the Wool Runner shoe", "for men") },
  { group: "store", name: "a store by its website", ask: "a yoga mat from jadeyoga.com", store: /jade/i, wants: one("Jade yoga mat", "a yoga mat") },
  { group: "store", name: "a Shopify store", ask: "a men's t-shirt from gymshark.com", store: /gymshark/i, wants: one("Gymshark t-shirt", "a t-shirt", "for men") },
  { group: "store", name: "a store brand", ask: "Kirkland extra virgin olive oil from Costco", store: /costco/i, wants: one("Kirkland olive oil", "olive oil", "Kirkland Signature brand") },
  { group: "store", name: "specialty coffee", ask: "a bag of Onyx Coffee Lab whole bean coffee", wants: one("Onyx coffee", "coffee beans", "roasted by Onyx Coffee Lab") },
  {
    group: "store",
    name: "a store with no search",
    ask: "AirPods 4 from the Apple store",
    mayAsk: true,
    context: "Agentcard may not be able to search Apple's own store. A right answer either shows AirPods 4 from Apple, or says plainly it cannot shop there and offers the same product elsewhere. It must not present another store's cards as Apple's.",
    wants: one("AirPods 4", "Apple AirPods", "the 4th generation, not Pro or Max"),
  },
  {
    group: "store",
    name: "a store Agentcard cannot pay at",
    ask: "a set of red wine glasses from Crate & Barrel",
    mayAsk: true,
    context: "Agentcard may not be able to pay at Crate & Barrel. A right answer either shows wine glasses from Crate & Barrel, or says plainly it cannot buy there. It must not silently switch to another store.",
    wants: one("red wine glasses", "wine glasses"),
  },
];

const kinds: Case[] = [
  { group: "kind", name: "a problem, no product named", ask: "my phone dies by lunchtime every day, what can I buy to fix that", wants: one("something that keeps a phone charged", "a power bank, battery case, portable charger or charger") },
  { group: "kind", name: "shorthand", ask: "lg c4 65in oled", wants: one("LG C4 65 inch OLED TV", "a television", "LG brand", "the C4 series", "65 inch") },
  { group: "kind", name: "a length", ask: "a 10 ft hdmi cable", wants: one("HDMI cable", "an HDMI cable", "about 10 feet long") },
  { group: "kind", name: "a dietary need", ask: "gluten free spaghetti", wants: one("gluten free spaghetti", "spaghetti or long pasta", "gluten free") },
  { group: "kind", name: "a gift for an age", ask: "a birthday present for a 6 year old who loves dinosaurs, under $25", maxPrice: 25, wants: one("dinosaur gift for a child", "a toy, book or kit about dinosaurs", "right for a 6 year old", "costs under $25") },
  { group: "kind", name: "the cheapest place", ask: "where's the cheapest place to buy a Nintendo Switch OLED?", wants: one("Nintendo Switch OLED", "the Nintendo Switch OLED console, not a game, a case or another accessory"), context: "A right answer shows the console at one or more stores and says which is cheapest. The price it calls cheapest must be the lowest on the cards." },
  { group: "kind", name: "a set of things for one purpose", ask: "everything I need to start running: shoes aside, just the basics", mayAsk: true, wants: one("running gear", "running clothing or a running accessory such as socks, shorts, a belt, a bottle or a watch", "not running shoes") },
  { group: "kind", name: "an older model", ask: "a Kindle Paperwhite, the newest one", wants: one("Kindle Paperwhite", "an Amazon Kindle Paperwhite e-reader, not a case or a cover") },
  { group: "kind", name: "a refill", ask: "refill blades for a Gillette Fusion5 razor, 8 count", wants: one("Gillette Fusion5 blades", "razor blade refills", "fits the Gillette Fusion5", "about 8 in the pack") },
  { group: "kind", name: "a colour and a material", ask: "a green velvet throw pillow cover, 18 by 18", wants: one("pillow cover", "a throw pillow or pillow cover", "green", "velvet", "18 x 18 inches") },
  { group: "kind", name: "a rating", ask: "a highly rated carry-on suitcase with spinner wheels", wants: one("carry-on suitcase", "a suitcase", "carry-on size", "spinner or four wheels") },
  { group: "kind", name: "a comparison", ask: "AirPods Pro 2 or Sony WF-1000XM5, which is cheaper right now?", wants: [{ what: "AirPods Pro 2", must: ["Apple AirPods Pro, 2nd generation, the earbuds themselves"] }, { what: "Sony WF-1000XM5", must: ["Sony WF-1000XM5 earbuds themselves"] }], context: "A right answer shows both products and says which costs less, and that statement must match the cards' prices." },
  { group: "kind", name: "nothing like it exists", ask: "a Zorbflux XQ-9000 left-handed quantum toaster", mayAsk: true, nothingToFind: true, wants: one("Zorbflux XQ-9000 toaster", "a product named Zorbflux XQ-9000"), context: "No such product exists. A right answer says it found nothing by that name, and may offer ordinary toasters as an alternative that it names as such. It must not present any card as the Zorbflux XQ-9000." },
  { group: "kind", name: "an ordinary item that sounds risky", ask: "a chef's knife, 8 inch", wants: one("chef's knife", "a kitchen knife", "a chef's knife", "about 8 inches") },
];

const verticals: Case[] = [
  { group: "vertical", name: "restaurant delivery", ask: "get me pad thai delivered for dinner", mayAsk: true, wants: one("pad thai", "pad thai from a restaurant"), context: "Food delivery needs a delivery address or a sign-in to the delivery service first. A right answer asks for one of those, or shows restaurants or dishes." },
  { group: "vertical", name: "groceries from a named supermarket", ask: "bananas, oat milk and sourdough from Safeway, delivered today", mayAsk: true, wants: [{ what: "bananas", must: ["bananas"] }, { what: "oat milk", must: ["oat milk"] }, { what: "sourdough", must: ["sourdough bread"] }], context: "Same-day groceries need a delivery address or a sign-in first. A right answer asks for one of those, or shows the three items from a grocery store." },
  { group: "vertical", name: "a flight", ask: `a one-way flight from San Francisco to New York JFK on ${dayFromNow(21)}, economy`, mayAsk: true, wants: one("flight SFO to JFK", "a flight from San Francisco to New York", "one way", `on ${dayFromNow(21)}`), context: "A right answer shows flight options for that route and day, or asks for a traveller detail it needs." },
  { group: "vertical", name: "a hotel", ask: `a hotel in downtown Chicago for two nights from ${dayFromNow(28)}, under $250 a night`, mayAsk: true, wants: one("hotel in Chicago", "a hotel room", "in Chicago", "under $250 a night"), context: "A right answer shows hotels in Chicago for those nights, or asks for a detail it needs." },
  { group: "vertical", name: "a rental car", ask: `a rental car at LAX for three days from ${dayFromNow(14)}`, mayAsk: true, wants: one("rental car at LAX", "a rental car", "picked up at or near Los Angeles airport"), context: "A right answer shows rental cars, or asks for a detail it needs." },
  { group: "vertical", name: "a restaurant table", priced: false, ask: `a table for two at an Italian restaurant in San Francisco on ${dayFromNow(7)} at 7pm`, mayAsk: true, wants: one("Italian restaurant table", "a restaurant in San Francisco", "Italian food"), context: "A right answer shows restaurants with a table near that time, or asks for a detail it needs." },
  { group: "vertical", name: "a fitness class", priced: false, ask: `a yoga class in Austin on ${dayFromNow(3)} morning`, mayAsk: true, wants: one("yoga class in Austin", "a yoga class", "in Austin"), context: "A right answer shows classes, or says plainly it found none." },
  { group: "vertical", name: "game tickets", priced: false, ask: "two tickets to the next Golden State Warriors home game", mayAsk: true, wants: one("Warriors tickets", "tickets to a Golden State Warriors game"), context: "A right answer shows tickets or games to choose from, with the seller named when it is a resale seller." },
  { group: "vertical", name: "a concert", priced: false, ask: "concerts in Brooklyn this weekend", mayAsk: true, wants: one("concert in Brooklyn", "a live music event", "in or near Brooklyn"), context: "A right answer shows events, or says plainly it found none." },
  { group: "vertical", name: "a ride", priced: false, ask: "get me an Uber to SFO airport", mayAsk: true, wants: one("ride to SFO", "a ride to San Francisco airport"), context: "A ride needs the rider's own Uber account and a pickup place. A right answer asks for one of those, or says plainly that it cannot book the ride." },
  { group: "vertical", name: "a delivery service not built yet", ask: "order sushi on Uber Eats", mayAsk: true, wants: one("sushi", "sushi from a restaurant"), context: "Agentcard cannot order through Uber Eats yet. A right answer says so plainly, and may offer another way to get sushi delivered. It must not act as if the order is going through Uber Eats." },
  { group: "vertical", name: "a home service not built yet", ask: "book someone on TaskRabbit to mount my TV", mayAsk: true, wants: one("TV mounting service", "a person or service that mounts a TV"), context: "Agentcard cannot book TaskRabbit yet. A right answer says so plainly. It must not show TV mounts as if they were the service, unless it says they are a different thing." },
];

const locales: Case[] = [
  { group: "locale", name: "Dutch", ask: "draadloze oordopjes", wants: one("wireless earbuds", "wireless earbuds"), context: "The replies should be in Dutch." },
  { group: "locale", name: "German", ask: "eine rutschfeste Yogamatte", wants: one("yoga mat", "a yoga mat"), context: "The replies should be in German." },
  { group: "locale", name: "Portuguese", ask: "fones de ouvido bluetooth", wants: one("bluetooth headphones", "bluetooth headphones or earbuds"), context: "The replies should be in Portuguese." },
  { group: "locale", name: "French", ask: "un sac à dos imperméable pour la randonnée", wants: one("waterproof hiking backpack", "a backpack", "for hiking", "waterproof or water resistant"), context: "The replies should be in French." },
  { group: "locale", name: "a European shoe size", ask: "zapatillas de running para hombre talla 42", wants: one("men's running shoes", "running shoes", "for men", "EU size 42, which is about US men's 9"), context: "The replies should be in Spanish." },
  { group: "locale", name: "metric units", ask: "a 2 litre stainless steel water bottle", wants: one("water bottle", "a water bottle", "stainless steel", "about 2 litres, which is about 64 to 68 fluid ounces") },
  { group: "locale", name: "a Dutch store", ask: "een waterkoker van bol.com", mayAsk: true, wants: one("electric kettle", "an electric kettle"), context: "Agentcard may not be able to buy from bol.com. A right answer, in Dutch, either shows kettles from bol.com or says plainly it cannot shop there. It must not present another store's cards as bol.com's." },
  { group: "locale", name: "Amazon Germany", ask: "eine Kaffeemühle von amazon.de", mayAsk: true, wants: one("coffee grinder", "a coffee grinder"), context: "A right answer, in German, either shows coffee grinders from Amazon's German store or says plainly it cannot shop there. Cards from the US Amazon store presented as amazon.de do not answer the ask." },
  { group: "locale", name: "Amazon UK", ask: "a pack of PG Tips tea bags from amazon.co.uk", mayAsk: true, wants: one("PG Tips tea", "tea bags", "PG Tips brand"), context: "A right answer either shows PG Tips from Amazon's UK store or says plainly it cannot shop there." },
  { group: "locale", name: "delivery to Canada", ask: "a toaster delivered to Toronto, Canada", mayAsk: true, wants: one("toaster", "a toaster"), context: "Agentcard may not deliver to Canada. A right answer either shows toasters it can deliver to Toronto or says plainly that it cannot deliver there. It must not ignore the destination." },
  { group: "locale", name: "two languages in one message", ask: "necesito un cargador para mi MacBook Air M2, the 35W one", wants: one("MacBook Air charger", "a laptop power adapter or charger", "works with a MacBook Air M2", "35 watts") },
];

export default [...stores, ...kinds, ...verticals, ...locales].map(({ group, name, ...expected }) =>
  defineEval({
    description: `${group}: ${name}`,
    tags: ["matrix", group],
    metadata: { ask: expected.ask },
    async test(t) {
      const turn = await t.send(expected.ask);
      t.succeeded();
      turn.calledTool("buy");
      await checkAnswer(t, turn, expected);
    },
  }),
);
