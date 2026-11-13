# support@agentcard.sh: audit of the last 50 sent emails

Pulled 2026-10-25 from Gmail (`in:sent`, account support@agentcard.sh). The 50 messages run from 13 Sep to 25 Oct 2026 and sit in 22 threads.

- **45 came from the support agent**, spread over 17 threads.
- **5 are Karen's "thanks for applying" startup-pricing template.** They're signed "Karen." and aren't agent output, so they're covered separately at the end.

## 1. What the 45 agent replies were about

| Customer | Thread | Agent replies | Topic | Where it stands |
|---|---|---|---|---|
| Alain / Bakua (live, YC) | AgentCard x Bakua (+ top-up thread) | 16 | Topping up a company card, declines, cardholder names missing on the issuer side, Sumsub retake loop, expired links, fraud-match rejections, blocked MCCs, webhook ordering | Active and well served on the technical side. Slack invite asked for on 13 Oct, never confirmed |
| Jeb McAviney (AU, live) | Production KYC stuck pending | 5 | Cardholder cap, then AU funding block, then turning on company_flow | **Lost.** He set a deadline of 9 Oct and said he'd move to another provider. His last 2 emails got no reply |
| Eddie / Nem | Vault dual provisioning with Stripe | 4 | SetupIntent via Vault, white-label onboarding, auto-approval, GBP | Active. The card-save switch and the "commercial terms, the team will come back to you" promise have been open since 15 Oct |
| Eliezer Greenberg | Human support requested: failed Walmart order | 3 | Cancelled order used up the free order; asked for a human | **Waiting 7 days, chased 3 times**, asked "which team or person owns the action" |
| Marcel B.H. | Cannot fund account | 1 (of 7 in thread) | Canada can't fund; switch him to Germany | **Stalled since 5 Sep.** Our last reply was 21 Sep, nothing since |
| Gabriel Orozco | AgentBundle activation | 1 (of 5) | $20 bundle: CLI never subscribes, checkout link | **Stalled since 30 Aug.** Last reply 22 Sep, nothing since |
| Derek Newman | Can't get verified | 1 (of 2) | Manual KYC review | **Stalled since 5 Aug.** Last reply 17 Sep |
| Avi / Friend | Friend sandbox: company balance | 2 | Two records for one person, $25 on the wrong one, switching the funding model | Record repair promised on 8 Oct, no update since |
| Omari / Reason | commerce_billing_required | 2 | Commerce fee gate, order cancelled for a bad address, webhook duplicate | **His 24 Oct question has no answer** (address format, free-order limit) |
| Fethy / SwiftPay (UK) | Enquiry and help needed | 2 | Can't send USDC on Base from Binance; UK can't fund | Waiting on a deposit address the agent won't give out |
| Sergej Durovic | Identity verification | 3 | Cardholder cap, price, name on card | Resolved |
| Vitalii Morgunov | Verification stuck | 1 | Issuer asked for a retake | Resolved, with a follow-up sent when the fix shipped |
| Nikita (Mintlify) | Supported funding countries | 1 | Country list | Resolved |
| Idan (Israel) | Personal account eligibility | 1 | Personal accounts closed, Israel not supported | Resolved (a clear no) |
| Andy Restu | Checkout overlap on the homepage demo | 1 | UI bug report | Resolved |
| Fo for Nathan / Rook | Get-started form follow-up | 1 | Sign-in help | Resolved |

Most of the volume comes from one customer: Bakua accounts for 16 of the 45 replies.

## 2. Numbers

- **Speed:** after a customer writes, the agent replies in a median of **~1 hour** (p75 1.7h). First response isn't the problem.
- **Resolution:** 9 of 17 threads are open on something only a person at Agentcard can do. Across the replies the agent wrote "with the team" 14 times and "flagged" 9 times, and in none of those threads did a follow-up from a human ever arrive.
- **Length:** median **316 words**. 21 of 45 replies are over 400 words, 7 are over 600, and the longest is about 1,100. Four use ALL-CAPS section headers ("WHAT HAPPENED", "THE ONE CENT").
- **Tics, counted across the agent's replies:**
  - "I would rather" 19
  - "sorry" 18
  - "Short version / Short answer" 15
  - "I am not putting a date on it" (or close to it) 12
  - "our bug" 12
  - "What would help" 10
- **Identity:** never signed by a person. It's "Agentcard Support", "AgentCard Support" or "— AgentCard support", which isn't even consistent. It writes "I" with no name behind it, so customers fall back to "Hi there".

## 3. What it does well (keep these)

- **The investigations are real.** It quotes transaction ids, timestamps to the second and webhook event ids, and it diffs what the customer sent against what we stored. Examples: the Bakua name-split comparison, the Netflix attempt that never reached us, the event published twice 48ms apart for Omari, and the race where `transaction.authorized` arrives before the decline.
- **It owns mistakes** and corrects itself in the open: the $25 vs $20 price, the wrong package name, the "your PATCH didn't land" claim.
- **It warns people before they hurt themselves:** "don't delete the account", "don't send USDC on another network", "don't send USDC until I confirm".
- **It doesn't make up dates.** That's the right instinct; section 4.1 covers how it went too far.
- Developers say they like it: "very helpful", "thanks for the honest update", "that's all clear".

## 4. What's wrong, most damaging first

### 4.1 It promises follow-ups it has no way to deliver
Nearly every open thread ends in "a person on our side needs to do X". Those handoffs go nowhere, so the customer ends up chasing:
- **Jeb** asked for a yes or no by 9 Oct and warned he'd leave. Nobody replied. He was ready to send USDC the same day.
- **Marcel** threatened to delete his account and start over after 16 days of "the reopen is still pending".
- **Gabriel** has been chasing a checkout link for 8 weeks.
- **Derek** has been chasing a manual review for 11 weeks.
- **Eliezer** has chased 3 times and had to ask who owns his case.

The "no date" line is honest once. By the third time in the same thread it reads as stonewalling.

The job's own log explains part of this. By 12 Sep it had **24 draft fix PRs open and zero merged across 85 consecutive cycles**. So "the fix is written and in review" usually meant a draft nobody was going to merge. Manual steps sat waiting too: Marcel's `/admin/kyc/sumsub-reset` was still "not run (day 5)", and the agentbundle-cli fix merged but npm publishing failed (E404, the token has no publish right), so Gabriel never got it.

### 4.2 Dropped threads
Customer emails are going unanswered despite the 1-hour median: Jeb's 5 Oct and 8 Oct emails, and Omari's 24 Oct follow-up (now over 30h old). Something in the pipeline is losing threads. Most likely threads that were already marked "replied" aren't being reopened when the customer writes again.

### 4.3 It tells different customers different things
- **Paid plans:** on 18 Oct it told Eliezer personal plans "cannot be bought". On 24 Oct it told Omari "upgrading that user's plan lifts the cap immediately". Separately, on 23 Sep it quoted Sergej "$15 a month" for the next plan up, and on 6 Oct it told Idan personal accounts are closed.
- **Wrong in the moment, fixed a turn later:** the $25 bundle price, the `@agent-cards/checkout` package name, "your PATCH didn't land", and the "the link expired after 48h" diagnosis.

There's no single source of truth for current facts, and nothing checks the record again before the agent asserts its state.

There's also likely a wrong answer still standing. The agent told Omari his user was blocked by the free-order limit. But `card-limits.ts` `isOrgBackedClient` exempts purchases made through an org-owned client, which Reason's Purchase API traffic most likely is. One DB check confirms it (see `support-agent/rescue.md` #1).

### 4.4 It reads like an incident report, not a person
Every reply has the same skeleton: Short version → What happened → What we're doing → What would help. It's long, has headers, and sometimes uses ALL CAPS. The tone doesn't follow the customer either:
- Andy sent a friendly two-line "my ADHD brain noticed…" and got about 300 words on CSS stacking.
- Sergej asked "what's the name on the card and the price" and got a plan-limits brief.

### 4.5 Nobody is behind the name
Eliezer's subject line is literally "Human support requested", and he got three more replies from the same unnamed "Agentcard Support". The agent never says it's an agent and never brings in a human. Compare Karen's template emails, signed "Karen.": they get warm, personal replies ("Hi Karen, that discount is amazing…").

### 4.6 It shares things it shouldn't
- **KYC decline reasons:** it told a partner that three named cardholders were rejected on a "fraud-pattern match" and asked whether they had prior attempts elsewhere. Sharing why an individual failed KYC is a compliance risk. That should go through compliance, not support.
- **Operational limits:** it told customers "our account has hit a cap on approved cardholders" at the issuer.
- **Internal economics:** it told Avi the payment provider took $1.03 and that we absorb it.

### 4.7 Revenue signals get handled as support tickets
Each of these needed a founder, not a ticket:
- Jeb was ready to fund.
- Avi (Friend) asked about live commercial terms.
- Eddie (Nem) asked about PCI scope, a dedicated domain and pricing three times, and got "the team will come back to you directly" every time.
- Alain (Bakua, live, YC) asked for a Slack invite.
- Fethy asked for a company account.

## 5. How to make it better and more human

**The deciding issue isn't tone. The agent is missing hands and a human behind it.** Fix the loop first; a voice rewrite on top of broken promises just makes them sound nicer.

| # | Strategy | What it fixes | How |
|---|---|---|---|
| 1 | **Every promise becomes a tracked loop with an owner** | 4.1, 4.2 | Whenever a reply says "a person needs to…", the agent opens an `open-loop` / Slack ticket naming Felipe or Karen, with the customer, the exact action and a due date. A watcher pings the owner at 24h and 72h. The thread can't go quiet more than 3 business days. |
| 2 | **Give it the common manual actions** | 4.1 | Most stalls are the same handful of operations: reset a free-order count, reopen KYC, switch the KYC country, turn on `company_flow` or the card-save switch, issue a checkout link, re-file at the issuer. Add them to the Support MCP as two-step preview-then-confirm writes, behind Karen's approval in WhatsApp. That turns "with the team" into "done, try again". |
| 3 | **Promise the next update, not the fix** | 4.1 | Replace "I am not putting a date on it" with "I'll write again by Thursday whether or not it's moved", and then actually write. Ban the no-date line after its first use in a thread. |
| 4 | **Human-handoff triggers** | 4.5, 4.7 | Hand off to a human, cc'd and introduced by name, when any of these happen: the customer asks for a human; the customer sets a deadline or threatens to churn; it's the 2nd chase on the same ask; commercial terms, pricing or contracts come up; it's a live production org above a spend threshold; a KYC/compliance decision is involved. |
| 5 | **A named, honest identity** | 4.5 | One persona name (e.g. "Juno from Agentcard") with a one-line disclosure that it's Agentcard's support agent, plus the human on the case named whenever there is one. It must never sign as Karen (her rule: no impersonating her). Make the casing consistent: "Agentcard". |
| 6 | **Voice rules** | 4.4 | Match the customer's length and register. Status updates in 2–4 sentences. Answer in plain words in the first line, with no "Short version:" label. No ALL-CAPS headers; use a numbered list only when the customer asked numbered questions. Use contractions. Vary openings. At most one apology per thread. Banned-phrase list: "I would rather", "that is on us", "I am not putting a date", "Short answer". Thank people for specific things, not generically. |
| 7 | **A fact sheet plus a contradiction check** | 4.3 | Keep one versioned facts file (plans and pricing, personal-account status, funding country list, package names, limits) that the agent must cite. Before sending, search its own sent mail from the last 30 days on the same topic and flag any conflict. |
| 8 | **Evidence before claims** | 4.3 | Any sentence about the state of a record ("not landed", "still pending", "expired") needs a query run in this cycle. Otherwise it says "I'm checking". |
| 9 | **Disclosure guardrails** | 4.6 | Hard rules: never share KYC decline reasons (fraud, duplicate, sanctions, age) for a named person, and route those to compliance. No issuer caps or vendor names. No fee internals. |
| 10 | **Send sales signals to founders** | 4.7 | Classify "ready to pay", "commercial terms", "Slack invite" and "company account" as a lead. Post it to Slack for Karen/Felipe, and the customer gets "Karen will reach out today", which then has to happen. |
| 11 | **Measure resolution, not first response** | all | Weekly scorecard: loops open more than 3 days, customer chases per thread, days to resolution, contradictions caught, plus a one-question CSAT line at the bottom of resolved threads. |

**My first three would be 1, 2 and 4.** They would have saved Jeb and stopped the Marcel, Gabriel, Derek and Eliezer chases. 5 and 6 are the "more human" layer and are cheap once the loop is fixed.

## 6. Threads to rescue now

1. **Jeb McAviney.** Probably already churned. Worth a personal note from Karen: apologize for missing his 9 Oct deadline and give a real yes or no on `company_flow`.
2. **Omari / Reason.** His 24 Oct questions are unanswered (address format, whether the free-order limit is lifetime). Also correct the "upgrade the user's plan" advice if personal plans really can't be bought.
3. **Eliezer Greenberg.** Reset the free-order count, then reply as a named human.
4. **Marcel.** Reopen KYC with the German address, or tell him no.
5. **Gabriel.** Send the $20 bundle checkout link, or check whether a newer agentbundle-cli is published.
6. **Derek.** Give a final answer on the manual review.
7. **Avi / Friend.** The record repair, plus commercial terms from a founder.
8. **Eddie / Nem.** The card-save switch, plus the PCI, domain and pricing conversation from a founder.
9. **Fethy.** Decide whether support can give out personal deposit addresses.
10. **Alain / Bakua.** Confirm the Slack invite.

## 7. Karen's "thanks for applying" template (5 sends)

These were sent from support@ and signed "Karen.". Three people replied, and none of those replies has an answer in this mailbox:
- **Lorenzo:** EU Vault and 3DS questions.
- **Zach Sweedler:** can't afford it, wants to talk.
- **Ayodhya:** just exploring.

They may have been handled on calls or from another inbox. I didn't verify that.

## Caveats

- The local `support-triage` job (`~/.claude/support-triage/`) has been disabled since 12 Sep. The replies after that came from a runner I didn't find on this Mac, probably Nori's Mac mini. So the prompt at `~/.claude/support-triage/prompt.md` is the pre-cutover version and may not match what's live.
- I only read the email side. I didn't check internal Slack or tickets, so some of the "never followed up" items may have moved internally without the customer being told.
