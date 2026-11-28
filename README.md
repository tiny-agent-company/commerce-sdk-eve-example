# commerce-sdk-eve-example

An [eve](https://eve.dev) agent that buys things for its users at real stores with the [Agentcard Commerce SDK](https://www.npmjs.com/package/@agent-cards/commerce-sdk). The agent gets one `buy` tool: it sends what the shopper says to Agentcard, and Agentcard finds the products, builds the cart and places the order once the shopper approves it.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example env file and fill it in:

   ```bash
   cp .env.example .env
   ```

   | Variable | Where to get it |
   |---|---|
   | `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET` | Run `npx agent-cards init` to create your company and its credentials. |
   | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

3. Start the development server:

   ```bash
   npm run dev
   ```

   The development TUI opens a chat with your agent. Try "two packs of AA batteries from Amazon".

## How it works

| File | What it does |
|---|---|
| [`agent/agent.ts`](agent/agent.ts) | Sets the model, `claude-sonnet-5`. |
| [`agent/instructions.md`](agent/instructions.md) | The system prompt. The Shopping section tells the agent to pass the shopper's words to `buy`, keep its reply short, and order only after the shopper says yes. |
| [`agent/tools/buy.ts`](agent/tools/buy.ts) | Wraps the SDK's `buyTool` as an eve tool. It keeps one buy tool per shopper and session, so each chat holds its own cart, and streams product, Vault and approval links to the chat as progress snapshots while the model reads only the final result. It sends Agentcard the shopper's latest message as they typed it, read from the chat, rather than the words the model put in `ask`. |
| [`agent/instructions/open-purchase.ts`](agent/instructions/open-purchase.ts) | While a purchase is open with Agentcard, tells the model before each call to pass the shopper's message to `buy` before it writes anything, so a shopper answering Agentcard's question is never answered by the model instead. |
| [`agent/lib/shopper-words.ts`](agent/lib/shopper-words.ts) | Picks the words the buy tool sends: the shopper's own message on the first call for it, and the model's words on a second call in the same reply. |
| [`agent/channels/eve.ts`](agent/channels/eve.ts) | The HTTP channel. The signed-in user becomes the shopper; without auth, and in local development and the evals, each session is its own shopper. |
| [`agent/lib/agnost.ts`](agent/lib/agnost.ts) | Sends each buy conversation to Agnost AI when `AGNOST_ORG_ID` is set. |
| [`evals/`](evals) | Checks that run real shopper messages through the agent and grade what comes back. |

The shopper approves each purchase on an Agentcard approval page, and a new shopper saves a card on a Vault page first. The model never sees these links, so it can't paste them into the chat. Your app shows them from the tool's snapshots.

## Evals

The evals send real shopper messages to the agent, which calls the live buy tool, and grade the answer. Nothing is ever ordered. No eval says yes to a cart, and each one fails if a call tries to confirm an order, with one exception: the checkout evals say yes with sandbox credentials only, where Agentcard stops every purchase at the payment, and they fail if anything is placed. See [Cart and checkout, store by store](#cart-and-checkout-store-by-store).

A run of an eval ends as one of a few kinds, so a failure of Agentcard's is never mixed with something else: it passed, it failed, the store gave its own answer (out of stock, for one), the example chat app in this repository made the mistake, or the run's own connection broke. See [How a run ends](#how-a-run-ends).

```bash
npm run eval                 # every eval
npm run eval -- buy/search   # only the one-message searches
npm run eval -- --exclude-tag matrix   # the core set, without the coverage matrix
npm run eval -- --tag locale # one group of the matrix: store, kind, vertical or locale
npm run eval -- --exclude-tag real     # leave out the real asks that failed
npm run eval -- --tag cart             # can each store put a product in the cart
npm run eval -- --tag checkout         # does each store get as far as the checkout step
npm run eval -- --tag asked-once       # is a shopper who said what they want asked again
npm run eval -- --tag store-account    # does Agentcard sign in with the shopper's own account at a store that needs one
npm run eval -- --tag refused-details  # is a shopper told which contact detail a booking refused, and why
npm run eval:purchases       # every cart and checkout eval three times, as the daily run sends them
npm run eval -- --verbose    # also print the products and Agentcard's reply for each eval
```

| File | What it covers |
|---|---|
| [`evals/buy/search.eval.ts`](evals/buy/search.eval.ts) | One message each: a plain product, a brand and model, an exact product, a named store, a budget, a price range, a quantity, a size and colour, specs, a part that must fit a model, things to leave out, a use with no product named, a typo, a vague gift, Spanish, a chatty ask, two products at once, groceries and restaurant food. To add a case, add a line to the list. |
| [`evals/buy/conversation.eval.ts`](evals/buy/conversation.eval.ts) | Several messages: narrowing a search, switching to another product, picking a product, and a greeting. |
| [`evals/buy/matrix.eval.ts`](evals/buy/matrix.eval.ts) | The coverage matrix, 66 cases in four groups: `store` (one per named store and per kind of store), `kind` (kinds of ask the searches do not hold), `vertical` (food, groceries, flights, hotels, cars, tables, classes, tickets, rides, and services not built yet) and `locale` (Portuguese, Dutch, German, French, Spanish, European sizes, metric units, stores and delivery outside the US; budgets are in US dollars only for now). |
| [`evals/buy/cart.eval.ts`](evals/buy/cart.eval.ts) | One eval per store and per supplier that can serve it: the shopper asks for one cheap product, picks a card, and the product must be in the cart, at that store, in the size and colour asked for, with a price and a total that adds up. See [Cart and checkout, store by store](#cart-and-checkout-store-by-store). |
| [`evals/buy/checkout.eval.ts`](evals/buy/checkout.eval.ts) | The same rows, one step further: the purchase must reach the final cart and the ask for a yes, and the yes must be stopped at the payment with nothing ordered. The file's first comment defines "got to the checkout step" and says why it is safe. |
| [`evals/buy/asked-once.eval.ts`](evals/buy/asked-once.eval.ts) | Eight ways a shopper who had said what they want was asked again, or shown a product that could not go in a cart: a product named in full, an answer to the store's own question, an answer sent with the price, a colour the store lists, a store listed without `www`, a card with a longer page address, a store in Canada, and a store named after another one. Each must reach a cart and never say what it used to say. |
| [`evals/buy/refused-details.eval.ts`](evals/buy/refused-details.eval.ts) | One booking asked for with the placeholder email and phone a booking supplier refuses: the shopper must be told which detail was refused, and why. |
| [`evals/lib/stores.ts`](evals/lib/stores.ts) | The list of stores and suppliers both files run. To add a store, add a row. |
| [`evals/lib/purchase.ts`](evals/lib/purchase.ts) | The shopper those evals play, with its placeholder address and details, and the fixed rules that check a cart and a chat. |
| [`evals/lib/store-answer.ts`](evals/lib/store-answer.ts) | The store's own answers (out of stock, another price, no seats, its own account needed), read from the answer's fields first. |
| [`evals/lib/questions.ts`](evals/lib/questions.ts) | Which questions are fair: one about a choice the product has is, one about something the shopper already said is not. |
| [`evals/lib/dates.ts`](evals/lib/dates.ts) | The days a booking's ask names, and the days a card or a booking is for. |
| [`evals/lib/connection.ts`](evals/lib/connection.ts) | A dropped connection is retried once, and a message is never sent twice. |
| [`evals/lib/outcome.ts`](evals/lib/outcome.ts) | The kinds a run ends as, and how the runs of one eval are counted together. |
| [`evals/buy/real.eval.ts`](evals/buy/real.eval.ts) | Real asks that did not get a good answer, loaded from a private Braintrust dataset when the evals run. See [Real asks that failed](#real-asks-that-failed). |
| [`evals/judge/calibration.eval.ts`](evals/judge/calibration.eval.ts) | Checks the judge itself with made-up answers whose faults are known. |
| [`evals/lib/buy.ts`](evals/lib/buy.ts) | Reads the cards the shopper saw and runs the checks. |
| [`evals/lib/judge.ts`](evals/lib/judge.ts) | The judge: a model that reads every card against every requirement of the ask. |
| [`evals/lib/slack-reporter.ts`](evals/lib/slack-reporter.ts) | Posts the evals that did not pass to Slack, one post per eval however many times it ran. |

### How an answer is graded

Every case spells out what the shopper asked for as a list of requirements, one fact each. "A screen protector for an iPhone 16" is two: it is a screen protector, and it is made for the iPhone 16 and not only for the Plus, Pro or Pro Max. The answer is graded on the product cards the shopper actually saw in the chat, not on the shorter list the model reads.

Fixed rules check what a rule can know exactly: the buy tool did not fail, no order was placed or started, every card has a name, a store and a price, every card comes from the store the shopper named, every card is inside the budget, and the agent's reply has no link.

A judge model (`claude-opus-5-5`, on the same Anthropic key) then reads every card against every requirement, and both replies against the cards. An eval fails when:

| Check | Fails when |
|---|---|
| `accurate-cards` | Fewer than 80% of the cards are what was asked for. |
| `top-cards-accurate` | One of the first three cards is not. |
| `every-item-covered` | Something the shopper asked for has no card that is it. |
| `recommended-fits` | A reply recommends a product that is not what was asked for, or that is on no card. |
| `agentcard-reply-true` | Agentcard's reply says something the cards contradict, such as a wrong price. |
| `agent-reply-true` | The chat agent's own one-line reply does. |
| `answers-the-ask` | The replies ignore part of the ask, or present something else as if it were it. |

The judge counts only what a card states. A shoe whose name gives no size does not break "size 10", and words of taste such as "nothing fancy" break nothing. A follow-up message may be answered from cards already in the chat, and is then graded on those.

### Cart and checkout, store by store

Two files check each store end to end, short of buying: [`evals/buy/cart.eval.ts`](evals/buy/cart.eval.ts) (tag `cart`) and [`evals/buy/checkout.eval.ts`](evals/buy/checkout.eval.ts) (tag `checkout`). Both make one eval per row of [`evals/lib/stores.ts`](evals/lib/stores.ts), and a row is a store together with the supplier that serves it.

Agentcard reaches a store through one of several suppliers, and the shopper never hears which. Two of them can serve the same big retailer:

- The retail ordering supplier searches the retailer and places the order. Its cart exists right after the pick, with a total that is an estimate until the order goes in.
- The product catalog supplier lists the product, and the purchase then runs through the store's own checkout page, which Agentcard fills in with a hosted browser. Its cart exists only once the store has priced it, tax and shipping included.

Agentcard's code chooses the supplier, not the shopper's words, so most stores have one row: the shopper picks the first card that is the product, and the eval logs which path the cart was checked out through. At a few retailers a card from the catalog takes a different path from a card that opens the store's own page (the store's own checkout instead of the retail supplier). Those retailers have a second row that picks only a catalog card. Every other supplier (a Shopify store's own catalog, a brand's own site, eBay's used listings, food delivery, flights, hotels, cars, tables, classes, tickets and events) has one row per store. There are countless Shopify stores, so one stands for all of them.

**The cart eval** passes when the cart exists at the named store, holds exactly the picked product and the asked quantity, shows a price (or marks the line `price_in_total`, priced only inside the total), has a total that adds up from its items and fees or is marked an estimate, and nothing was ordered.

**The checkout eval** goes on to the last step before money can move:

1. The shopper gives what the checkout asks for (a delivery address, a name, an email, a phone number) and Agentcard shows the final cart and asks for the yes. The cart must still hold the picked product, and the total must never change between two answers without the reply naming the new one.
2. For goods, the shopper says yes, and the answer must be the payment step and nothing past it: in the sandbox a refusal that says test mode cannot pay (`sandbox_mode`) or that the shopper has no test card (`test_card_missing`); with a card, the approval page or the page to save one. A retailer may first price the order's tax and shipping, so the shopper waits and asks for an update every half minute, for about ten minutes at most, and says yes again only to a newly priced total. When Agentcard offers to keep waiting or to look at another store, the shopper keeps waiting, within the same ten minutes. A store that sends no total in those ten minutes, while Agentcard kept the shopper told and offered to keep waiting or to try another store, is the store's own answer: "the store was slow to price". The shopper waits the same way when the store is still pricing the cart before the yes, read from the cart's `pricing` field first and from words such as "being priced" when it carries none.

Both evals also check, at every store, by fixed rules:

| Check | What must be true |
|---|---|
| `cart-line-times-quantity-is-subtotal` | One unit's price times the quantity is the store's subtotal, as the store's own order summary gives it where Agentcard read it. A $26.99 line under a $28.99 subtotal means another product is in the cart. |
| `cart-shows-asked-size`, `cart-shows-asked-color` | For a product asked for in a size and a colour, the cart's line shows both. |
| `cart-before-approval` | No approval or payment step comes before a cart: the shopper sees what they are buying, and its price, first. |
| `fields-agree-with-reply` | When a reply asks for a yes, in any words, the answer's next step is the confirm (`next_action: confirm`) and no detail is still listed as missing. An app draws its button from the fields. |
| `reply-total-is-the-carts` | When a reply asks for a yes, it names the amount the yes is for: the cart's total, or its estimate with the most the card is held for. |
| `cart-reply-amounts-are-the-carts` | No reply that shows a cart, not only the one that asks for the yes, quotes an amount the cart's fields contradict. True amounts the cart holds in another form pass: shipping and tax named apart, the gap between the card's price and the store's, a deposit, the most the card is held for. A wrong estimate fails. |
| `no-password-in-chat` | No reply asks the shopper to type a password into the chat. A store account is given on Agentcard's own page. |
| `questions-are-fair` | Every question is about a choice the product has and the shopper has not made yet. A question about a size or a colour is fair, and a clarifying question is never a failure. A question about something the shopper already said is one, and so are several choices with placeholders for names, which nobody can answer. |
| `never-an-empty-reply` | Agentcard's answer always says something to the shopper. |
| `refused-detail-is-named` | A detail the shopper gave and Agentcard asks for again is named in the reply, with the reason it was not taken. |
| `cards-inside-the-dates`, `booking-inside-the-dates` | For a booking with a date (a flight, a room, a car, a table, a class, a ticket, an event), every card that names a day, and the booking held, is for the days the shopper asked for. |
| `cards-can-be-booked` | Only what can be booked becomes a card: nothing without seats or room, and nothing with no price (a table is free). What has no room is said in the reply instead. |

**What the shopper does.** It picks only a card at the store it named, with a price, and for a booking only one with room, for the days asked. Asked for a choice, it gives the value it already named ("M" for a medium) and otherwise the first the store lists. Asked for a size or a colour with none listed, it gives the one its ask named, else a medium or any colour in stock: a clarifying question is answered, never the end of the chat. It never takes another colour or size than it asked for. When the store lists the product's colours or sizes without that one, or Agentcard says the one asked for is sold out and offers what the product's page has, the shopper picks another card that fits from those it was shown, twice at most, and the chat fails only when none does. Such a question is fair: what the shopper asked for cannot be had. It says yes to an offer to add a product or a booking when there is no cart yet, only when the offer is at the store it named, and to an offer to try a checkout again once. Clothing is asked for with a size and a colour at every store on the list that sells it. A booking is asked for with contact details the booking suppliers accept: an email at Agentcard's own domain, where nothing sent can reach a stranger, and a mobile number from the range Australia's regulator keeps for films and TV, which no person can hold. When Agentcard says a detail was not taken, the shopper gives their other one, once. One eval keeps the placeholders a supplier refuses ([`evals/buy/refused-details.eval.ts`](evals/buy/refused-details.eval.ts)), to check the shopper is told which detail was refused and why.

**How a reply is read.** Everything the shopper and the checks read in a reply's words is read by a model, never by lists of words ([`evals/lib/reply-reader.ts`](evals/lib/reply-reader.ts)), because the same ask comes in many wordings:
- what it asks: the yes that pays, a yes to an address read back, an offer to add a product, a product's own option, contact details, how many, keep waiting or another store;
- which contact details it asks for, and which detail it says was refused, with or without a reason;
- the choices it lists in words, the values it says cannot be had, and which value fits the shopper's ask;
- the products it asks the shopper to choose among, and whether each fits the ask;
- a question about something the shopper already said;
- whether the store is still pricing, and what the store itself answered (out of stock, another price, nothing to book);
- whether its amounts agree with the cart. The answer's fields come first wherever there is one: `next_action: confirm` is the yes, and the cart's `pricing` is a store still pricing. The reader runs on the example app's own model, once per reply, and [`evals/judge/reply-reader.eval.ts`](evals/judge/reply-reader.eval.ts) checks it on real replies whose reading is known.

**When Agentcard says it is still working.** A store's own checkout can take minutes, and the answer to a message can come back as "still working" before the cart exists. The shopper then waits and asks "any update?" every twenty seconds, for eight minutes at most, and the eval fails only when no result ever arrives. An empty answer is waited out the same way, and fails `never-an-empty-reply` on its own.

**When the connection drops.** A dropped connection to the chat is retried once. The first message is sent again in a fresh chat. A later message is never sent again, so a yes can never be sent twice: the eval connects to the same chat again and reads the answer there. When that message never arrived, the whole chat runs once more from its first message in a fresh chat, which is safe because no eval can place an order. Only a second chat that breaks too ends as `run broke`. Slack and Braintrust show the last chat, the one the eval was graded on.

Three things keep this safe. The evals run with sandbox credentials only and skip themselves otherwise, and Agentcard refuses every sandbox payment before it reserves money, makes a card or calls a store. Each chat is a new shopper with no saved card, and no eval opens a page to save or approve one. And every detail the shopper gives is a placeholder: a public landmark as the address, a stand-in name, and an email and a phone number that belong to no person.

Some purchases stop earlier. A booking (a flight, a room, a car, a table, a class, a ticket) stops at step 1, because no eval says yes to a booking. A booking whose search answers with the code `no_availability` is that store's own answer, read before any words. Food delivery stops when the cart is built and the shopper is handed the sign-in to their own account, because an eval has no such account and must not use a real one. A ride is skipped for the same reason: its first step is that sign-in, and a ride can be had nowhere else. A row is also skipped, with the reason, when a store's checkout refuses the placeholder details (AutoZone). Stores that cannot put anything in a cart yet (Uber Eats, Rappi, Rinse, TaskRabbit and a few more) are listed with the reason at the end of `stores.ts` and have no eval.

Every rule is fixed; no judge model reads a cart. A store that is down, a supplier that shows no card for the store, or a checkout that asks for something the shopper cannot give fails that one eval with the reason in plain words, and the run goes on.

### How a run ends

Every run of an eval ends as one kind ([`evals/lib/outcome.ts`](evals/lib/outcome.ts)). Only `failed` is counted against Agentcard, and nothing else is hidden: each kind is shown in Slack, in Braintrust and in the console.

| Kind | What it means |
|---|---|
| `passed` | Every check held. |
| `failed` | A check about Agentcard did not hold. |
| `store's own answer` | The purchase stopped on something only the store decides, and Agentcard said so: the product is out of stock, the store's price is not the card's, a booking has no seats or no availability, the store needs the shopper's own account and the evals have no test account there, the store sent no total in the time the shopper waited while Agentcard kept them told, the store has closed its online checkout for now (such as for the Sabbath), or the store or its supplier says the item is no longer available. The last two count only when Agentcard says so and offers a way on: the same item at another store, or when to try again. Read from the stop code first (`checkout_closed`, `store_closed`), then from the reply's reading. Neither a pass nor a failure. |
| `example app's mistake` | The example chat app in this repository got it wrong and nothing of Agentcard's did: its model answered the shopper itself instead of calling the buy tool, wrote a link, or changed the shopper's words. The shopper then says the message again, so the rest of the chat is still checked. |
| `run broke` | The eval's own connection to the chat broke in two chats running. |
| `skipped` | The eval did not run, with its reason. |

A store's own answer is read from the answer's fields where it has one: the code a purchase stopped with, the cart's `price_change`, a card's `availability`, the sign-in step. Where an answer carries no field for it, the reply's reading by a model says it, and the result says which it was ([`evals/lib/store-answer.ts`](evals/lib/store-answer.ts)).

**A store that needs the shopper's own account.** Agentcard signs in with the shopper's own account at that store, which the shopper gives once on Agentcard's own page, never in the chat. An eval must never use a real account and never creates one, so a store counts as having a test account only once a person makes one there and saves it on Agentcard's store sign-in page for one test shopper, `evals-store-accounts` ([`evals/lib/store-accounts.ts`](evals/lib/store-accounts.ts) lists those stores; none yet). A run is that shopper when it starts with `EVAL_SHOPPER_ID=evals-store-accounts`: the example app then uses that one shopper for every chat ([`agent/tools/buy.ts`](agent/tools/buy.ts)). Every other run gives each chat a shopper of its own, with no account anywhere, so there a sign-in is graded as if no account were saved. Until then a sign-in asked for first is that store's own answer, "no test account at this store" (`sign-in-offered-first`). Questions about the product's own options (its size, its colour) may come before it, since Agentcard asks those first on purpose. A sign-in asked for after the shopper answered any other question is a failure: they answered it for nothing. At a store with a test account, a sign-in asked for at all is a failure (`signs-in-with-saved-account`): Agentcard signs in with the saved account by itself. Food delivery is different, because its cart is built before the sign-in. [`evals/buy/store-account.eval.ts`](evals/buy/store-account.eval.ts) (tag `store-account`) watches the stores the evals have seen ask for an account, Costco, McMaster-Carr and TikTok Shop, and also checks that the account asked for is the one at the store the shopper named. The daily run sends these evals last, in a run of their own, as the test shopper.

**Three runs, one after another, two chats at a time.** A store's own checkout does not behave the same way twice, so the daily run sends each cart and checkout eval three times (`--repeat 3`) and reports how many of the three passed: "Passed 2 of 3 runs. 1 failed." The three runs of one eval go one after another, never side by side, and no more than two purchase chats run at once in all ([`evals/lib/one-after-another.ts`](evals/lib/one-after-another.ts); `PURCHASE_CHATS_AT_ONCE` changes the two): a supplier that prices one order at a time at a store made the second and third runs wait in line behind the first, and store sign-ins in hosted browsers failed when several ran together (2026-11-27). `npm run eval:purchases` does the same by hand.

### Failed evals in Slack

Set `SLACK_BOT_TOKEN` (a bot that can post to the channel) and `SLACK_EVALS_CHANNEL` (the channel's id). Each eval that did not pass is posted once, however many times it ran, as the conversation of one run that did not pass, word for word:

- the post is the first message sent to the agent, under "Message sent to the agent:";
- its thread holds the agent's reply, under "Agent's reply:", then each next message and reply;
- the last reply in the thread is "Why the eval failed:", with how many of the eval's runs passed ("Passed 1 of 3 runs. 2 failed. This thread shows run 2."), then one line per failed check. A run that failed for another reason is told under its own line, and runs that failed the same way are named together.

An eval whose only trouble was the example chat app's mistake, or a broken connection, is posted the same way under a headline that says so.

A run of the evals that sent each eval more than once, or saw a store's own answer or a mistake of the example chat app, ends with one closing message: how many runs ended as each kind, then each store's own answer with what Agentcard said, each mistake of the example chat app, the evals that passed only some of the time, and the evals that failed every time. A store's own answer gets no post of its own.

A run where everything passes posts nothing. A run posts at most 25 evals, failures of Agentcard's first; Braintrust holds every one. The counts by kind are printed to the console at the end of every run, with or without Slack.

### Results in Braintrust

Set `BRAINTRUST_API_KEY` and each run is saved as an experiment in the Braintrust project "Buy evals", one row per eval ([`evals/lib/braintrust-reporter.ts`](evals/lib/braintrust-reporter.ts)). A row reads as the conversation it was:

| Column | What it holds |
|---|---|
| Input | The messages the shopper sent, in order. |
| Output | For each graded turn: the product cards the shopper saw, Agentcard's reply and the chat agent's reply. |
| Expected | What the shopper asked for, as the requirements each card was checked against. |
| Scores | Every check by name, 1 for passed and 0 for failed; `accurate-cards` is the share of cards that are what was asked for. |
| Metadata | The eval's name and verdict, under `did_not_pass` each failed check with the judge's reason, and under `result` how the run ended ([How a run ends](#how-a-run-ends)): `passed`, `failed`, `store's own answer`, `example app's mistake`, `run broke` or `skipped`. A store's own answer is under `store_answer`, with whether it was read from a field or from the reply's words, and each message the example chat app answered itself is under `app_mistakes`. |
| Tags | The eval's tags, and the kind again as `result: failed`, to filter a run by. |

To see what went wrong in a run, sort by `accurate-cards` or filter on a score below 1, open a row, and read `did_not_pass` beside the cards in Output. To compare two runs, open one experiment and pick the other under Compare.

When a run sends each eval three times, every run of an eval is a row of its own, named `buy/cart/0007#2`, with its number under `attempt`. Group the rows by `eval` to read how many of an eval's runs passed.

### Real asks that failed

Every message a shopper sends to the buy endpoint, and every reply, is already kept by Agentcard's backend. A daily job turns the ones that went badly into evals, so the suite grows from what real shoppers ask and not only from what we thought to write down.

The asks themselves are never in this repository, which is public. They live in the Braintrust dataset "Real asks that failed" in the project "Buy evals", and [`evals/buy/real.eval.ts`](evals/buy/real.eval.ts) loads them each time the evals run.

**What the job does** ([`real-asks/pick.ts`](real-asks/pick.ts)), for one day of conversations:

1. Reads the day's live conversations and leaves out test traffic ([`real-asks/read.ts`](real-asks/read.ts)):
   - a company's test mode;
   - companies the backend marks as Agentcard's own, unless listed in `REAL_ASKS_KEEP_COMPANIES`;
   - any company, client or shopper on the skip lists, by exact id: the merchant monitors' shoppers, the load test's and the store sweep's clients, the eval suite's client. An automated caller is named there and never guessed from how much it sends, so a busy shopper is not left out;
   - this repository's own evals. They run with test-mode credentials, so the first rule already leaves them out, and their client's id belongs on `REAL_ASKS_SKIP_CLIENTS`. On top of both, a conversation that opens, word for word, with a message one of the eval files sends is left out whatever company or client it came through ([`real-asks/own-evals.ts`](real-asks/own-evals.ts)). A real shopper who types exactly what an eval sends is left out too, which loses nothing: that ask is already an eval.
2. Looks for the signs of a bad answer that a fixed rule can read ([`real-asks/signals.ts`](real-asks/signals.ts)):

   | Sign | How it is read |
   |---|---|
   | `said it was wrong` | The shopper's next message says so: "that's not what I asked for", "wrong", "I said". |
   | `rephrased` | After a search, the shopper asks the same thing again within 15 minutes in other words. |
   | `nothing found` | A search ran and the reply says it found nothing, or the answer showed no product. |
   | `refused` | The answer's status is `declined` on a typed ask. |
   | `no answer` | Nothing came back at all. |
   | `checkout failed` | A cart or an order stopped short. Counted only: no eval ever places an order, so it cannot be sent again. |
   | `left after the first answer` | One message, one answer, nothing more. Counted only: most apps open a new conversation for every ask, so it says little. |

3. Has a model clean each candidate and draft its requirements ([`real-asks/prepare.ts`](real-asks/prepare.ts)), then runs the evals' own judge over the answer the shopper got. An answer is picked as `the judge failed the answer` when it is clearly wrong: nothing was shown, something asked for has no product that is it, fewer than half the cards are what was asked for, or the reply does not respond to the ask. A narrower miss is not picked on the judge's word alone, because the requirements it was judged against are a draft. This is the only sign that costs model calls, so it is capped (`REAL_ASKS_MOST_JUDGED`, 150 a day).

   **Which cards the judge reads** is decided in one place, `cardsOf` in [`real-asks/cards.ts`](real-asks/cards.ts). When the backend stored the cards with the turn, the judge reads those, and its verdict can be trusted. The backend is only now starting to store them, and the field's name and shape are not final: the reader looks for a list under the turn's `cards` (or the key named in `REAL_ASKS_CARDS_FIELD`) and treats anything else as "not stored". For a turn without them the job falls back to a guess: the first eight products of the conversation's last search, which may not be the cards the shopper saw. A judge verdict on guessed cards is a hint, not a finding. Each saved row says under `seen.cards_are` which of the two it was.
4. Removes personal details. Fixed patterns replace links, email addresses, phone and card numbers, order and account ids and street addresses ([`real-asks/scrub.ts`](real-asks/scrub.ts)); the model replaces names and whatever else a pattern cannot know; the patterns then run again over the model's text. A message that needs its link, the shopper's account or a personal detail to make sense is dropped, and so is a yes, a pick or an answer to a question.
5. Drops an ask the dataset already holds, or one worded almost the same as a kept one, and saves the rest as drafts: at most `REAL_ASKS_MOST_SAVED` (20) a day and `REAL_ASKS_MOST_PER_COMPANY` (5) from one company, the cases with the most signs first. Running the same day twice saves nothing twice.
6. Posts each saved row to Slack for review, when `SLACK_BOT_TOKEN` and `SLACK_EVALS_CHANNEL` are set ([`real-asks/review-post.ts`](real-asks/review-post.ts)): one short message per row, never repeated. See [Reviewing a row](#reviewing-a-row).

**What a row holds**

| Field | What it holds |
|---|---|
| `input.messages` | The cleaned messages to send: the ask, and the earlier messages of the chat when the ask depends on them. |
| `expected.wants` | The requirements, in the shape the judge reads: each thing asked for (`what`) and the facts a product must meet to be it (`must`). |
| `expected.may_ask`, `expected.priced`, `expected.right_answer` | Whether a question back is a right answer; whether cards carry a price; and what a right answer looks like when it is not simply showing the thing. |
| `metadata.review` | `draft, not reviewed` when the job saves the row. A thumbs up or thumbs down in Slack changes it to `reviewed` or `rejected`, with who and when under `review_by`, `review_at` and `review_via`, and who decided under `decided_by` (see [Reviewing a row](#reviewing-a-row)). |
| `metadata.slack` | The channel and timestamp of the row's review post, which is how an emoji on the post is tied back to the row. |
| `metadata.fix` | The issue that tracks the fix, once the row has its thumbs up. |
| `metadata.picked_for`, `day`, `kind` | The signs, the day of the conversation, and the kind of thing asked for (retail, groceries, flights and so on). |
| `metadata.conversation`, `metadata.company` | Hashes of the conversation's and the company's ids. |
| `metadata.seen` | The start of the reply the shopper got, cleaned; the cards they were shown, and whether those are stored cards or a guess; and the checks the judge failed. |

#### Reviewing a row

A row does not run until a person has reviewed it, and reviewing takes one emoji. Each saved row is posted to the evals channel in Slack as three lines:

```
🛒 *Shopper:* a yoga mat under $30 that ships to Canada
🤖 *Agent:* I couldn't find a yoga mat under $30. Want me to look at other stores?
👍 / 👎
```

The shopper's message is the cleaned one saved on the row. The reply is its first sentence or two, cleaned the same way: the fixed patterns, then a model for what a pattern cannot know, then the patterns again, and a reply that cannot be cleaned safely is not shown. Raw text is never posted.

| Your emoji on the post | What happens |
|---|---|
| 👍 (any skin tone) | The row's `metadata.review` becomes `reviewed`, so it runs as an eval from the next daily run and fails until the fix is live. An issue is opened with the ask, the reply, the cards, the requirements and the command that sends the ask again, and a coding agent starts on it: root cause first, then a fix in the backend for every store, then a pull request. The post gets a reply naming the issue, an hourglass while the agent works and a check when the pull request lands. When the agent finds the answer was fine after all, it says so in the thread and closes the issue. |
| 👎 | The row's `metadata.review` becomes `rejected` and the post gets a wastebasket. A rejected row never runs, and keeping it stops the same ask from being picked again. |

An emoji from a person on the team counts. No bot's counts, with one exception: the team's assistant reviews each post that no person has reacted to within 30 minutes. It replies in the thread with its reasons and adds 👍 or 👎, or says it is unsure and leaves the post for a person. Its emoji is acted on only after 10 minutes, so a person can overrule it. A person's emoji always wins, and so does taking the assistant's emoji off. The row records who decided under `metadata.decided_by`, and the assistant's reasons under `metadata.nori_review`. A decision is final: taking the emoji off later changes nothing. To undo one, change `metadata.review` on the row in Braintrust.

The emoji are read by a small job outside this repository, on the machine that runs Agentcard's other alert handling. It looks only at the messages a row points at through `metadata.slack`, so the run summaries posted to the same channel ([Failed evals in Slack](#failed-evals-in-slack)) are never treated as something to fix.

```bash
npm run real-asks:post -- --limit 10   # post the ten newest rows that have no post yet
npm run real-asks:post                 # post every row that has no post yet
npm run real-asks:post -- --dry-run    # how many it would post
```

`real-asks:post` is for rows saved before the job posted them itself, or for a day when Slack could not be reached. It needs `BRAINTRUST_API_KEY`, `SLACK_BOT_TOKEN` and `SLACK_EVALS_CHANNEL`. A row saved before replies were kept shows the judge's one-line account of the reply in the reply's place.

A row can still be reviewed by hand in Braintrust (project "Buy evals", Datasets, "Real asks that failed"), which is also where its requirements are corrected:

1. Read `input.messages`. Check that no personal detail is left, and that the last message is a shopping ask that makes sense on its own or with the earlier messages. If either fails, set `metadata.review` to `rejected`.
2. Read `expected.wants` against the ask. Each `must` has to be something the shopper actually said, stated as one fact a product card (a name, a store and a price) could show or contradict. Remove a requirement the shopper did not state or that no card could ever show, such as "returnable". Add one that is missing. Split one that holds two facts.
3. Check `expected.may_ask`: `true` when asking the shopper a question first is a right answer, as for food that needs a delivery address.
4. If the thing asked for cannot exist or cannot be bought, such as a flight in a window where none flies, set `metadata.review` to `rejected`: the eval could never pass.

**Running them.** The real asks run with the daily run and not with the six-hourly one, and only rows marked `reviewed` run, at most `REAL_ASKS_LIMIT` (30 unless set) a run, the newest first. Without `BRAINTRUST_API_KEY`, with an empty dataset, or while no row is reviewed, the eval skips and says why, with the number of drafts waiting. `REAL_ASKS_RUN_DRAFTS=1` also runs the drafts, for a run made on purpose by hand, and `REAL_ASKS_ONLY=<row id>` runs one row alone (several ids, separated by commas), whatever its review short of rejected. In Slack a real ask that fails shows its row id and the names of the failed checks only; the ask and the answer are in Braintrust.

```bash
npm run eval -- --tag real                            # the reviewed rows
REAL_ASKS_RUN_DRAFTS=1 npm run eval -- --tag real     # the drafts too
REAL_ASKS_ONLY=real-0123456789abcdef npx eve eval buy/real --verbose   # one row, with its cards and replies
npm test                                              # the cleaning patterns, the rules and the row reader, on made-up messages
```

**Running the job on a server.** The job is one command with no settings file: everything comes from environment variables. It has to run where the backend's database can be reached with a login that can only read.

```bash
npm ci
npm run real-asks                                  # yesterday (UTC), saved to Braintrust
npm run real-asks -- --day 2026-11-24              # one day
npm run real-asks -- --day 2026-11-24 --dry-run    # the day's numbers, saving nothing
```

It needs Node 24. It prints numbers only, never a shopper's words, and ends with one line: `real-asks ok: day=... conversations=... read=... asks=... prepared=... picked=... saved=... rows_in_dataset=... posted_for_review=...` and exit code 0, or `real-asks failed: ...` with the reason and the same numbers, and exit code 1 when the run broke part way or 2 when a setting is missing.

| Variable | Needed | What it is |
|---|---|---|
| `REAL_ASKS_DATABASE_URL` | yes, or the `PG` variables | The database's address with a read-only login, `postgres://user:password@host:5432/database`. Every query is read only, covers one day and has a row limit. |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | instead of the address | The same, as separate variables, when that is how the server hands out the login. |
| `REAL_ASKS_DATABASE_CA` | recommended | The path of the certificate authority file for the database (for Amazon RDS, its `global-bundle.pem`). With it the database's certificate is checked; without it the link is encrypted but the certificate is not checked. |
| `ANTHROPIC_API_KEY` | yes | For the model that cleans the asks and for the judge. |
| `BRAINTRUST_API_KEY` | yes, except with `--dry-run` | To read and save the dataset. |
| `SLACK_BOT_TOKEN`, `SLACK_EVALS_CHANNEL` | recommended | The bot and the channel each saved row is posted to for review. Without them the rows are saved and not posted; `npm run real-asks:post` posts them later. |
| `REAL_ASKS_SKIP_COMPANIES`, `REAL_ASKS_SKIP_CLIENTS`, `REAL_ASKS_SKIP_SHOPPERS` | yes, in production | The exact ids of automated callers to leave out, separated by commas: the merchant monitors' shoppers (the backend's `MERCHANT_MONITOR_USER_IDS` setting), the load test's and the store sweep's clients, the eval suite's client. These lists are the only thing that keeps automated callers out of a live company's traffic, so keep them current. The ids are never written in this repository. |
| `REAL_ASKS_KEEP_COMPANIES` | no | Ids of companies to read even when the backend marks them as Agentcard's own. |
| `REAL_ASKS_MOST_JUDGED`, `REAL_ASKS_MOST_SAVED`, `REAL_ASKS_MOST_PER_COMPANY` | no | The day's caps: 150 asks judged, 20 rows saved, 5 from one company. |
| `REAL_ASKS_CARDS_FIELD` | no | The key under a stored turn that holds its cards, if the backend names it something other than `cards`. |

Run it once a day after 12:00 UTC, so that a follow-up sent in the twelve hours after midnight is in.

### Scheduled runs on Modal

[`modal_app.py`](modal_app.py) runs the evals on [Modal](https://modal.com): the core set every six hours, the coverage matrix and the reviewed real asks once a day, and the cart and checkout evals once a day in a run of their own, each sent three times, because each is a chat of several messages with a live store. That run took 102 minutes on 2026-11-26 and has six hours before Modal stops it. Since 2026-11-27 its three runs of each eval go one after another and no more than two chats run at once, so it takes about five hours and has twelve. The job that picks the real asks does not run on Modal. Each run checks out the current `main` first, so a merged change is picked up by the next run with no new deploy.

```bash
modal deploy modal_app.py            # once, and again only when modal_app.py changes
modal run modal_app.py::core         # run the core set now
modal run modal_app.py::everything   # run the daily set now
modal run modal_app.py::purchases    # run the cart and checkout evals now, three times each
```

The keys live in the Modal secret `buy-evals`: `ANTHROPIC_API_KEY`, `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_EVALS_CHANNEL` and `BRAINTRUST_API_KEY`. Eval chats are not shoppers, so no run on Modal sends anything to Agnost: the runs start without Agnost's variable, whatever the secret holds.

## Conversation tracking with Agnost AI

[Agnost AI](https://agnost.ai) shows what shoppers ask and what they get back. Set `AGNOST_ORG_ID` to the organization id from Agnost's settings page, and every call of the buy tool is recorded there, grouped into one conversation per chat. Without the variable nothing is sent.

Agnost receives the shopper's words as the tool sent them to Agentcard, Agentcard's reply with every link taken out, and a few facts to filter by: the status, the names of the products shown, and the cart's store and total. The shopper is named by a hash of their id. A shopper's words can hold personal details such as a delivery address, so check that Agnost is approved for that before turning it on in production.

## Deploy on Vercel

```bash
npm run deploy
```

Set `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET` and `ANTHROPIC_API_KEY` on the Vercel project first (and `AGNOST_ORG_ID` if you track conversations), and replace `placeholderAuth()` in `agent/channels/eve.ts` with your app's auth provider before going to production. See the [eve deployment docs](https://eve.dev/docs/guides/deployment/vercel).

## Learn more

- [Commerce SDK README](https://www.npmjs.com/package/@agent-cards/commerce-sdk): links, pop-ups, events without webhooks, and every other framework.
- [eve documentation](https://eve.dev/docs): tools, channels, skills, subagents and schedules.
