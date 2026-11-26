import { defineEvalConfig } from "eve/evals";
import { braintrustReporter } from "./lib/braintrust-reporter.js";
import { slackReporter } from "./lib/slack-reporter.js";

export default defineEvalConfig({
  // A search can take a minute, and a conversation eval sends two.
  timeoutMs: 300_000,
  // Every eval is a real shopper conversation at Agentcard, so only a few run at once.
  maxConcurrency: 4,
  reporters: [
    slackReporter(),
    // Each run becomes an experiment in the Braintrust project "Buy evals" when BRAINTRUST_API_KEY is set.
    braintrustReporter({ projectName: "Buy evals" }),
  ],
});
