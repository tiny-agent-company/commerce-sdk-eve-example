# Threads to rescue (as of 2026-10-26)

Rechecked 2026-10-26: no new customer mail on any of these since 25 Oct. Each entry has what we owe, the decision only Karen or Felipe can make, and a draft reply in the v2 voice. Nothing has been sent.

---

## 1. Omari Nyarko / Reason: unanswered since 24 Oct 08:13 UTC

**What we owe:** answers to his two questions, plus a correction. On 24 Oct the agent told him his user was blocked by the one-free-order limit and suggested "upgrading that user's plan". The code exempts purchases made through an org-owned OAuth client from that limit (`card-limits.ts` `isOrgBackedClient`). If Reason's client is org-owned, his user was never blocked.

**Check before sending:** in the read-only prod DB, confirm `OAuthClient.organizationId` is set for Reason's client (org `org_99018df73ec41a8e808de483`).

**Draft (assumes the check passes):**

> Hi Omari,
>
> First, a correction: your user isn't blocked. Purchases made through your company's own connection don't count against the personal free-order limit, so you can retry right away. I had that wrong on Friday, sorry about that.
>
> On your questions:
>
> 1. The store only told us it couldn't use the address, not which part. Its checkout tends to reject apartment numbers in the street line, so try "3247 Bruner Ave" on line 1 and "Apt 1" on line 2. If it fails again, send me the order id and I'll dig into that specific attempt.
> 2. That limit belonged to the old personal accounts, which we've retired. Agentcard is for companies now, so it doesn't apply to your integration at all.
>
> Your user will need to approve once more, since the old approval expired.
>
> Sam, Agentcard support

---

## 2. Jeb McAviney: gave a deadline of 9 Oct, got no reply, said he'd move providers

**Decision for Karen:** yes or no on live company-funded issuance for `org_195c4c2125dbbc567799bfcd` (Australia, USDC on Base).

**Draft, to send from karen@agentcard.com, personally:**

> Hi Jeb,
>
> Karen here, I run Agentcard. You asked us for a yes or no by 9 October and we went quiet. That's not how I want us to treat anyone, and I'm sorry.
>
> The answer is [yes: company funding is on for your org, and you can send USDC on Base to the address in your company wallet whenever you're ready / no: we can't support company-funded cards for you right now].
>
> If you've already moved on, I understand. If not, I'd love 15 minutes to get you live myself.
>
> Karen

---

## 3. Eliezer Greenberg: asked for a human, chased 3 times

**Settled 2026-10-27:** there's no personal product, so there's no paid route for him to continue on. The honest answer is a clear close, not another "the team is deciding".

**Optional decision for Karen:** reset his free-order count anyway as a goodwill gesture, so the cancelled order doesn't cost him his one order. If you'd rather not, drop the middle paragraph.

**Draft, from Karen:**

> Hi Eliezer,
>
> Karen here, I run Agentcard. You asked for a person, and you should have had one on 18 October. I'm sorry you had to chase us three times.
>
> The straight answer to what you've been waiting on: we no longer offer Agentcard to individuals. It's only for companies building on top of it now, which is why there's no plan you could have upgraded to, and why we kept failing to give you a route.
>
> Because the cancelled Walmart order should never have used up your free order, I've reset it, so you can place that one order if you still want to. Nothing was ever charged, and the company account you opened on 6 October has nothing on it. Tell me if you'd like it closed.
>
> Karen

---

## 4. Marcel (Canada, wants to switch to his German address): stalled since 5 Sep

**Settled 2026-10-27:** he's an individual, so the KYC reopen no longer helps him. Tell him plainly.

**Draft:**

> Hi Marcel,
>
> I owe you a clear answer after five weeks of "still pending", and I'm sorry it took this long. We've stopped offering Agentcard to individuals. It's only for companies now, so switching your verification to Germany wouldn't get you a working account, and I don't want you to spend more time on it.
>
> Nothing was ever charged. If you'd like the account closed, reply "close it" and it's done.
>
> Sam, Agentcard support

---

## 5. Gabriel Orozco: the $20 bundle, stalled since 30 Aug

**Decision for Karen or Felipe:** issue a $20/mo Stripe checkout link for gabe@orozcosolutions.com. The `org-payment-link` agent can do this. Or fix the `agentbundle-cli` npm publish: `NPM_TOKEN` has no publish right, so 0.2.3 failed with E404 on 7 Sep.

**Draft:**

> Hi Gabriel,
>
> Here's your $20/mo bundle link: <link>. It's tied to gabe@orozcosolutions.com, so paying it turns the bundle on for your existing account, and nothing else changes.
>
> Sorry this took two months.
>
> Sam, Agentcard support

---

## 6. Derek Newman: manual KYC review, stalled since 5 Aug

**Settled 2026-10-27:** his address is enny.ai, so he may be building a product rather than buying for himself. Close the personal question and offer the company route.

**Draft:**

> Hi Derek,
>
> Sorry this took months to answer. Your personal verification won't be reopened, and we've stopped offering personal accounts anyway, so there's nothing on that account to wait for.
>
> If you're building something at Enny that needs to give agents cards, that's exactly what Agentcard is for now, and a company account goes through its own setup. Reply and I'll get you started.
>
> Sam, Agentcard support

---

## 7. Avi Schiffmann / Friend: record repair promised 8 Oct

**For Felipe:**
- Move the verified identity and the $25 balance onto Friend's org-side record for `usr_39202348d673fd99285bbfec`, or refund the $25.
- Commercial terms for live company pooling come from Karen.

Draft once the record is fixed: 3 lines saying "done, here's how to check it", plus a cc to Karen for terms.

---

## 8. Eddie Mammy / Nem: card-save switch, plus PCI, domain and pricing asked 3 times

**For Felipe:** turn on the card-save switch for `org_fee793c30b21627e794f70e1` before their late-November live test.

**For Karen:** the commercial, PCI scope and dedicated-domain conversation. Book a call rather than reply by email.

---

## 9. Fethy / SwiftPay (UK): wants a personal USDC deposit address

**Settled 2026-10-27:** no personal balances. He wrote from SwiftPay, so the company account is the answer and not a fallback.

**Draft:**

> Hi Fethy,
>
> I should have said this clearly the first time: Agentcard is only for companies now, so there's no personal balance to fund and no personal deposit address to give you. Sorry for sending you round in circles.
>
> A company account for SwiftPay works today. Its balance has its own deposit address, and that's the route I'd set you up on. Want me to start it for SwiftPay Technologies Group Ltd?
>
> Sam, Agentcard support

---

## 10. Alain / Bakua: Slack invite for contact@bakua.app, asked 13 Oct

**For Karen:** send the Slack Connect invite. Bakua is a live production customer on a YC team, with the most active thread we have.
