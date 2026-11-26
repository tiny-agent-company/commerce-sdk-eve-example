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
| [`agent/tools/buy.ts`](agent/tools/buy.ts) | Wraps the SDK's `buyTool` as an eve tool. It keeps one buy tool per shopper and session, so each chat holds its own cart, and streams product, Vault and approval links to the chat as progress snapshots while the model reads only the final result. |
| [`agent/channels/eve.ts`](agent/channels/eve.ts) | The HTTP channel. The signed-in user becomes the shopper; without auth, each session is its own shopper. |
| [`agent/lib/agnost.ts`](agent/lib/agnost.ts) | Sends each buy conversation to Agnost AI when `AGNOST_ORG_ID` is set. |
| [`evals/`](evals) | Checks that run real shopper messages through the agent and grade what comes back. |

The shopper approves each purchase on an Agentcard approval page, and a new shopper saves a card on a Vault page first. The model never sees these links, so it can't paste them into the chat. Your app shows them from the tool's snapshots.

## Evals

The evals send real shopper messages to the agent, which calls the live buy tool, and grade the answer. Nothing is ever ordered: no eval says yes to a cart, and each one fails if a call tries to confirm an order.

```bash
npm run eval                 # every eval
npm run eval -- buy/search   # only the one-message searches
npm run eval -- --exclude-tag matrix   # the core set, without the coverage matrix
npm run eval -- --tag locale # one group of the matrix: store, kind, vertical or locale
npm run eval -- --exclude-tag real     # leave out the real asks that failed
npm run eval -- --verbose    # also print the products and Agentcard's reply for each eval
```

| File | What it covers |
|---|---|
| [`evals/buy/search.eval.ts`](evals/buy/search.eval.ts) | One message each: a plain product, a brand and model, an exact product, a named store, a budget, a price range, a quantity, a size and colour, specs, a part that must fit a model, things to leave out, a use with no product named, a typo, a vague gift, Spanish, a chatty ask, two products at once, groceries and restaurant food. To add a case, add a line to the list. |
| [`evals/buy/conversation.eval.ts`](evals/buy/conversation.eval.ts) | Several messages: narrowing a search, switching to another product, picking a product, and a greeting. |
| [`evals/buy/matrix.eval.ts`](evals/buy/matrix.eval.ts) | The coverage matrix, 66 cases in four groups: `store` (one per named store and per kind of store), `kind` (kinds of ask the searches do not hold), `vertical` (food, groceries, flights, hotels, cars, tables, classes, tickets, rides, and services not built yet) and `locale` (Portuguese, Dutch, German, French, Spanish, European sizes, metric units, stores and delivery outside the US; budgets are in US dollars only for now). |
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

### Failed evals in Slack

Set `SLACK_BOT_TOKEN` (a bot that can post to the channel) and `SLACK_EVALS_CHANNEL` (the channel's id). A run where an eval did not pass posts one message, with a reply under it for each eval: what the shopper typed, the agent's reply, and each check that failed with the products it saw. A run where everything passes posts nothing. A long run details its first 25 evals and names the rest in one reply.

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

The asks themselves are never in this repository, which is public. They live in the Braintrust dataset "Real asks that failed" in the project "Buy evals", and [`evals/buy/real.eval.ts`](evals/buy/real.eval.ts) loads them each time the evals run. Without `BRAINTRUST_API_KEY`, or while the dataset is empty, that file holds one eval that skips and says why.

**What the job does** ([`real-asks/pick.ts`](real-asks/pick.ts)), for one day of conversations:

1. Reads the day's live conversations and leaves out test traffic: a company's test mode, companies the backend marks as Agentcard's own, any company, client or shopper on the skip lists, and any shopper who opened more than 40 conversations that day, which is a monitor or a benchmark ([`real-asks/read.ts`](real-asks/read.ts)).
2. Looks for the signs of a bad answer that a fixed rule can read ([`real-asks/signals.ts`](real-asks/signals.ts)):

   | Sign | How it is read |
   |---|---|
   | `said it was wrong` | The shopper's next message says so: "that's not what I asked for", "wrong", "I said". |
   | `rephrased` | After a search, the shopper asks the same thing again within 15 minutes in other words. |
   | `nothing found` | A search ran and the reply says it found nothing, or no product was stored for the message. |
   | `refused` | The answer's status is `declined` on a typed ask. |
   | `no answer` | Nothing came back at all. |
   | `checkout failed` | A cart or an order stopped short. Counted only: no eval ever places an order, so it cannot be sent again. |
   | `left after the first answer` | One message, one answer, nothing more. Counted only: most apps open a new conversation for every ask, so it says little. |

3. Has a model clean each candidate and draft its requirements ([`real-asks/prepare.ts`](real-asks/prepare.ts)), then runs the evals' own judge over the answer the shopper got, when the backend still holds its products. The backend keeps a search's products in order but not which of them became cards, so the first eight stand for the cards. An answer is picked as `the judge failed the answer` when it is clearly wrong: nothing was shown, something asked for has no product that is it, fewer than half the cards are what was asked for, or the reply does not respond to the ask. A narrower miss is not picked on the judge's word alone, because the requirements it was judged against are a draft. This is the strongest sign and the only one that costs model calls, so it is capped (`REAL_ASKS_MOST_JUDGED`, 150 a day).
4. Removes personal details. Fixed patterns replace links, email addresses, phone and card numbers, order and account ids and street addresses ([`real-asks/scrub.ts`](real-asks/scrub.ts)); the model replaces names and whatever else a pattern cannot know; the patterns then run again over the model's text. A message that needs its link, the shopper's account or a personal detail to make sense is dropped, and so is a yes, a pick or an answer to a question.
5. Drops an ask the dataset already holds, or one worded almost the same as a kept one, and saves the rest: at most `REAL_ASKS_MOST_SAVED` (20) a day and `REAL_ASKS_MOST_PER_COMPANY` (5) from one company, the cases with the most signs first.

**What a row holds**

| Field | What it holds |
|---|---|
| Input | The cleaned messages to send: the ask, and the earlier messages of the chat when the ask depends on them. |
| Expected | The requirements (`wants`) in the shape the judge reads, whether a question back is a right answer, and what a right answer looks like when it is not simply showing the thing. |
| Metadata | `review` (`draft, not reviewed` until a person changes it), `picked_for` (the signs), `day`, `kind` (retail, groceries, flights and so on), `conversation` (a hash of the conversation's id) and `seen` (the products the shopper was shown and the checks the judge failed). |

**Reviewing a row.** Requirements are a model's draft. Open the dataset in Braintrust, read a row, correct `expected.wants` if needed and set `metadata.review` to `reviewed`. Set it to `rejected` to stop a row from running; leave the row in place, so the same ask is not picked again.

**Running them.** The real asks run with the daily run and not with the six-hourly one. One run sends at most `REAL_ASKS_LIMIT` rows (30 unless set), reviewed rows first and then the newest. In Slack a real ask that fails shows its row id and the names of the failed checks only; the ask and the answer are in Braintrust.

```bash
npm run real-asks -- --day 2026-11-24 --dry-run   # the day's numbers, saving nothing
npm run real-asks                                 # yesterday, saved to Braintrust
npm run eval -- --tag real                        # run the saved asks
npm test                                          # the cleaning patterns and the rules, on made-up messages
```

The job prints numbers only and never a shopper's words. It needs `ANTHROPIC_API_KEY`, `BRAINTRUST_API_KEY` and a place to read the day from, the first of these that is set:

| Variable | Reads from |
|---|---|
| `REAL_ASKS_FILE` | A JSON file in the shape `Day` of `real-asks/read.ts`, for trying the job out. |
| `REAL_ASKS_EXPORT_URL`, `REAL_ASKS_EXPORT_TOKEN` | An export served over HTTPS that answers `GET ?day=2026-11-24` in the same shape. Agentcard's backend has no such export yet. |
| `REAL_ASKS_DATABASE_URL` | The backend's Postgres, with a login that can only read. Every query is read only, covers one day and has a row limit. |

`REAL_ASKS_SKIP_COMPANIES`, `REAL_ASKS_SKIP_CLIENTS` and `REAL_ASKS_SKIP_SHOPPERS` take ids separated by commas, and `REAL_ASKS_MOST_PER_SHOPPER` changes the 40.

[`modal_real_asks.py`](modal_real_asks.py) runs the job on Modal once a day at 14:10 UTC. It is a Modal app of its own, deployed only once its secret `buy-evals-real-asks` exists with the variables above.

### Scheduled runs on Modal

[`modal_app.py`](modal_app.py) runs the evals on [Modal](https://modal.com): the core set every six hours and everything, with the coverage matrix and the real asks that failed, once a day. Each run checks out the current `main` first, so a merged change is picked up by the next run with no new deploy.

```bash
modal deploy modal_app.py            # once, and again only when modal_app.py changes
modal run modal_app.py::core         # run the core set now
modal run modal_app.py::everything   # run everything now
```

The keys live in the Modal secret `buy-evals`: `ANTHROPIC_API_KEY`, `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_EVALS_CHANNEL`, `BRAINTRUST_API_KEY` and, to track conversations, `AGNOST_ORG_ID`.

## Conversation tracking with Agnost AI

[Agnost AI](https://agnost.ai) shows what shoppers ask and what they get back. Set `AGNOST_ORG_ID` to the organization id from Agnost's settings page, and every call of the buy tool is recorded there, grouped into one conversation per chat. Without the variable nothing is sent.

Agnost receives the shopper's words as the agent passed them to the tool, Agentcard's reply with every link taken out, and a few facts to filter by: the status, the names of the products shown, and the cart's store and total. The shopper is named by a hash of their id. A shopper's words can hold personal details such as a delivery address, so check that Agnost is approved for that before turning it on in production.

## Deploy on Vercel

```bash
npm run deploy
```

Set `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET` and `ANTHROPIC_API_KEY` on the Vercel project first (and `AGNOST_ORG_ID` if you track conversations), and replace `placeholderAuth()` in `agent/channels/eve.ts` with your app's auth provider before going to production. See the [eve deployment docs](https://eve.dev/docs/guides/deployment/vercel).

## Learn more

- [Commerce SDK README](https://www.npmjs.com/package/@agent-cards/commerce-sdk): links, pop-ups, events without webhooks, and every other framework.
- [eve documentation](https://eve.dev/docs): tools, channels, skills, subagents and schedules.
