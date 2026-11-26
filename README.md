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
npm run eval                 # every eval, about a minute and a half
npm run eval -- buy/search   # only the one-message searches
npm run eval -- --verbose    # also print the products and Agentcard's reply for each eval
```

| File | What it covers |
|---|---|
| [`evals/buy/search.eval.ts`](evals/buy/search.eval.ts) | One message each: a plain product, a brand and model, an exact product, a named store, a budget, a price range, a quantity, a size and colour, specs, a part that must fit a model, things to leave out, a use with no product named, a typo, a vague gift, Spanish, a chatty ask, two products at once, groceries and restaurant food. To add a case, add a line to the list. |
| [`evals/buy/conversation.eval.ts`](evals/buy/conversation.eval.ts) | Several messages: narrowing a search, switching to another product, picking a product, and a greeting. |
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

Set `SLACK_BOT_TOKEN` (a bot that can post to the channel) and `SLACK_EVALS_CHANNEL` (the channel's id). A run where an eval did not pass posts one message, with a reply under it for each eval: what the shopper typed, the agent's reply, and each check that failed with the products it saw. A run where everything passes posts nothing.

### Results in Braintrust

Set `BRAINTRUST_API_KEY` and each run is saved as an experiment in the Braintrust project "Buy evals", one row per eval with every check as a score, so two runs can be compared side by side.

### Scheduled runs

[`.github/workflows/buy-evals.yml`](.github/workflows/buy-evals.yml) runs the evals every six hours and on demand from the Actions tab. It reads the repository secrets `ANTHROPIC_API_KEY`, `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET`, `SLACK_BOT_TOKEN`, `BRAINTRUST_API_KEY` and `AGNOST_ORG_ID`, and the repository variable `SLACK_EVALS_CHANNEL`.

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
