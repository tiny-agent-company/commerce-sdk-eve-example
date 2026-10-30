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

The shopper approves each purchase on an Agentcard approval page, and a new shopper saves a card on a Vault page first. The model never sees these links, so it can't paste them into the chat. Your app shows them from the tool's snapshots.

## Deploy on Vercel

```bash
npm run deploy
```

Set `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET` and `ANTHROPIC_API_KEY` on the Vercel project first, and replace `placeholderAuth()` in `agent/channels/eve.ts` with your app's auth provider before going to production. See the [eve deployment docs](https://eve.dev/docs/guides/deployment/vercel).

## Learn more

- [Commerce SDK README](https://www.npmjs.com/package/@agent-cards/commerce-sdk): links, pop-ups, events without webhooks, and every other framework.
- [eve documentation](https://eve.dev/docs): tools, channels, skills, subagents and schedules.
