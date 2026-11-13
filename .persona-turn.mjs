// Plays Persona's app: one user message through the Commerce SDK's buy tool, as agent/tools/buy.ts does.
// usage: node .persona-turn.mjs "<message>"
import { readFileSync } from 'node:fs';
import { AgentcardClient, buyTool, buyToolDefinition } from '@agent-cards/commerce-sdk';
const company = JSON.parse(readFileSync('/tmp/uber-live/company.json', 'utf8'));
const agentcard = new AgentcardClient({ clientId: company.clientId, clientSecret: company.clientSecret, baseUrl: 'http://localhost:3088' });
const buy = buyTool({ agentcard, externalUserId: 'persona-rider-karen', threadId: 'persona-rides-thread-1' });
const ask = process.argv[2];
const turn = buy.turn(ask, {
  onReaction: () => {},
  onItem: (item) => console.log('ITEM', JSON.stringify(item).slice(0, 600)),
  onResult: (r) => console.log('RESULT', JSON.stringify({ status: r.status, carts: r.carts }).slice(0, 1500)),
});
const text = await turn.handle({ ask, confirm: process.env.CONFIRM === '1', new_order: process.env.NEW_ORDER === '1', product_id: process.env.PRODUCT_ID || null, store_id: process.env.STORE_ID || null });
console.log('REPLY', text);
for (const l of turn.links ?? []) console.log('LINK', JSON.stringify(l));
