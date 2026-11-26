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
| [`agent/lib/shopper-words.ts`](agent/lib/shopper-words.ts) | Picks the words the buy tool sends: the shopper's own message on the first call for it, and the model's words on a second call in the same reply. |
| [`agent/channels/eve.ts`](agent/channels/eve.ts) | The HTTP channel. The signed-in user becomes the shopper; without auth, and in local development and the evals, each session is its own shopper. |
| [`agent/lib/agnost.ts`](agent/lib/agnost.ts) | Sends each buy conversation to Agnost AI when `AGNOST_ORG_ID` is set. |
| [`evals/`](evals) | Checks that run real shopper messages through the agent and grade what comes back. |

The shopper approves each purchase on an Agentcard approval page, and a new shopper saves a card on a Vault page first. The model never sees these links, so it can't paste them into the chat. Your app shows them from the tool's snapshots.

## Evals

The evals send real shopper messages to the agent, which calls the live buy tool, and grade the answer. Nothing is ever ordered. No eval says yes to a cart, and each one fails if a call tries to confirm an order, with one exception: the checkout evals say yes with sandbox credentials only, where Agentcard stops every purchase at the payment, and they fail if anything is placed. See [Cart and checkout, store by store](#cart-and-checkout-store-by-store).

```bash
npm run eval                 # every eval
npm run eval -- buy/search   # only the one-message searches
npm run eval -- --exclude-tag matrix   # the core set, without the coverage matrix
npm run eval -- --tag locale # one group of the matrix: store, kind, vertical or locale
npm run eval -- --exclude-tag real     # leave out the real asks that failed
npm run eval -- --tag cart             # can each store put a product in the cart
npm run eval -- --tag checkout         # does each store get as far as the checkout step
npm run eval -- --verbose    # also print the products and Agentcard's reply for each eval
```

| File | What it covers |
|---|---|
| [`evals/buy/search.eval.ts`](evals/buy/search.eval.ts) | One message each: a plain product, a brand and model, an exact product, a named store, a budget, a price range, a quantity, a size and colour, specs, a part that must fit a model, things to leave out, a use with no product named, a typo, a vague gift, Spanish, a chatty ask, two products at once, groceries and restaurant food. To add a case, add a line to the list. |
| [`evals/buy/conversation.eval.ts`](evals/buy/conversation.eval.ts) | Several messages: narrowing a search, switching to another product, picking a product, and a greeting. |
| [`evals/buy/matrix.eval.ts`](evals/buy/matrix.eval.ts) | The coverage matrix, 66 cases in four groups: `store` (one per named store and per kind of store), `kind` (kinds of ask the searches do not hold), `vertical` (food, groceries, flights, hotels, cars, tables, classes, tickets, rides, and services not built yet) and `locale` (Portuguese, Dutch, German, French, Spanish, European sizes, metric units, stores and delivery outside the US; budgets are in US dollars only for now). |
| [`evals/buy/cart.eval.ts`](evals/buy/cart.eval.ts) | One eval per store and per supplier that can serve it: the shopper asks for one cheap product, picks a card, and the product must be in the cart, at that store, with a price and a total that adds up. See [Cart and checkout, store by store](#cart-and-checkout-store-by-store). |
| [`evals/buy/checkout.eval.ts`](evals/buy/checkout.eval.ts) | The same rows, one step further: the purchase must reach the final cart and the ask for a yes, and the yes must be stopped at the payment with nothing ordered. The file's first comment defines "got to the checkout step" and says why it is safe. |
| [`evals/lib/stores.ts`](evals/lib/stores.ts) | The list of stores and suppliers both files run. To add a store, add a row. |
| [`evals/lib/purchase.ts`](evals/lib/purchase.ts) | The shopper those evals play, with its placeholder address and details, and the fixed rules that check a cart. |
| [`evals/buy/real.eval.ts`](evals/buy/real.eval.ts) | Real asks that did not get a good answer, loaded from a private Braintrust dataset when the evals run. See [Real asks that failed](#real-asks-that-failed). |
| [`evals/judge/calibration.eval.ts`](evals/judge/calibration.eval.ts) | Checks the judge itself with made-up answers whose faults are known. |
| [`evals/lib/buy.ts`](evals/lib/buy.ts) | Reads the cards the shopper saw and runs the checks. |
| [`evals/lib/judge.ts`](evals/lib/judge.ts) | The judge: a model that reads every card against every requirement of the ask. |
| [`evals/lib/slack-reporter.ts`](evals/lib/slack-reporter.ts) | Posts the evals that did not pass to Slack. |

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

**The cart eval** passes when the cart exists at the named store, holds exactly the picked product and the asked quantity, shows a price, has a total that adds up from its items and fees or is marked an estimate, and nothing was ordered.

**The checkout eval** goes on to the last step before money can move:

1. The shopper gives what the checkout asks for (a delivery address, a name, an email, a phone number) and Agentcard shows the final cart and asks for the yes. The cart must still hold the picked product, and the total must never change between two answers without the reply naming the new one.
2. For goods, the shopper says yes, and the answer must be the payment step and nothing past it: in the sandbox a refusal that says test mode cannot pay (`sandbox_mode`) or that the shopper has no test card (`test_card_missing`); with a card, the approval page or the page to save one. A retailer may first price the order's tax and shipping, so the shopper waits and says yes again, for about six minutes at most.

Three things keep this safe. The evals run with sandbox credentials only and skip themselves otherwise, and Agentcard refuses every sandbox payment before it reserves money, makes a card or calls a store. Each chat is a new shopper with no saved card, and no eval opens a page to save or approve one. And every detail the shopper gives is a placeholder: a public landmark as the address, a stand-in name, an email on a domain reserved for examples and a phone number from the range reserved for fiction.

Some purchases stop earlier. A booking (a flight, a room, a car, a table, a class, a ticket) stops at step 1, because no eval says yes to a booking. Food delivery, and a store that only checks out signed in, stop when the cart is built and the shopper is handed the sign-in to their own account, because an eval has no such account and must not use a real one. A ride is skipped for the same reason: its first step is that sign-in. A row is also skipped, with the reason, when a store's checkout refuses the placeholder details (AutoZone) or always needs the shopper's own account before it builds a cart (Costco). Stores that cannot put anything in a cart yet (Uber Eats, Rappi, Rinse, TaskRabbit and a few more) are listed with the reason at the end of `stores.ts` and have no eval.

Every rule is fixed; no judge model reads a cart. A store that is down, a supplier that shows no card for the store, or a checkout that asks for something the shopper cannot give fails that one eval with the reason in plain words, and the run goes on.

### Failed evals in Slack

Set `SLACK_BOT_TOKEN` (a bot that can post to the channel) and `SLACK_EVALS_CHANNEL` (the channel's id). Each eval that did not pass is posted as its conversation, word for word:

- the post is the first message sent to the agent, under "Message sent to the agent:";
- its thread holds the agent's reply, under "Agent's reply:", then each next message and reply;
- the last reply in the thread is "Why the eval failed:", one line per failed check.

A run where everything passes posts nothing. A run posts at most 25 evals; Braintrust holds every one.

### Results in Braintrust

Set `BRAINTRUST_API_KEY` and each run is saved as an experiment in the Braintrust project "Buy evals", one row per eval ([`evals/lib/braintrust-reporter.ts`](evals/lib/braintrust-reporter.ts)). A row reads as the conversation it was:

| Column | What it holds |
|---|---|
| Input | The messages the shopper sent, in order. |
| Output | For each graded turn: the product cards the shopper saw, Agentcard's reply and the chat agent's reply. |
| Expected | What the shopper asked for, as the requirements each card was checked against. |
| Scores | Every check by name, 1 for passed and 0 for failed; `accurate-cards` is the share of cards that are what was asked for. |
| Metadata | The eval's name and verdict, and under `did_not_pass` each failed check with the judge's reason. |

To see what went wrong in a run, sort by `accurate-cards` or filter on a score below 1, open a row, and read `did_not_pass` beside the cards in Output. To compare two runs, open one experiment and pick the other under Compare.

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
| `metadata.review` | `draft, not reviewed` when the job saves the row. A person's thumbs up or thumbs down in Slack changes it to `reviewed` or `rejected`, with who and when under `review_by`, `review_at` and `review_via`. |
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

Only an emoji from a person on the team counts, never a bot's. A decision is final: taking the emoji off later changes nothing. To undo one, change `metadata.review` on the row in Braintrust.

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

[`modal_app.py`](modal_app.py) runs the evals on [Modal](https://modal.com): the core set every six hours, the coverage matrix and the reviewed real asks once a day, and the cart and checkout evals once a day in a run of their own, because each is a chat of several messages with a live store and the run takes up to an hour. The job that picks the real asks does not run on Modal. Each run checks out the current `main` first, so a merged change is picked up by the next run with no new deploy.

```bash
modal deploy modal_app.py            # once, and again only when modal_app.py changes
modal run modal_app.py::core         # run the core set now
modal run modal_app.py::everything   # run the daily set now
modal run modal_app.py::purchases    # run the cart and checkout evals now
```

The keys live in the Modal secret `buy-evals`: `ANTHROPIC_API_KEY`, `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_EVALS_CHANNEL`, `BRAINTRUST_API_KEY` and, to track conversations, `AGNOST_ORG_ID`.

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
