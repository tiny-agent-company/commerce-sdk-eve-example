import { defineEval } from "eve/evals";
import { cardsShown, checkAnswer, checkWordsUnchanged, type Card } from "../lib/buy.js";
import { DATASET, draftsWaiting, loadRealAsks, REVIEWED, rowsToRun } from "../lib/real-asks.js";

/**
 * Real asks that did not get a good answer, sent again. The cases are not in this file or anywhere in the repository:
 * they are loaded from the private Braintrust dataset "Real asks that failed" each time the evals run (lib/real-asks.ts),
 * where a daily job saves them with personal details removed (real-asks/pick.ts).
 *
 * Each ask is sent to the buy tool as the other evals send theirs, and its answer is graded by the same checks against
 * the requirements saved on the row. A row's requirements are a model's draft until a person sets the row's
 * `metadata.review` to `reviewed` in Braintrust, and only reviewed rows run. REAL_ASKS_RUN_DRAFTS=1 also runs the
 * drafts, for a run made on purpose by hand.
 *
 * At most REAL_ASKS_LIMIT rows run (30 unless set), the newest first, so the cost of a run does not grow with the
 * dataset. Without BRAINTRUST_API_KEY, with an empty dataset, or while no row is reviewed, the file holds one eval
 * that skips and says why, with the number of drafts waiting for review.
 */
const loaded = await loadRealAsks();
const limit = Number(process.env.REAL_ASKS_LIMIT ?? 30);
const drafts = /^(1|true|yes)$/i.test(process.env.REAL_ASKS_RUN_DRAFTS ?? "");
const rows = rowsToRun(loaded.rows, Number.isFinite(limit) ? limit : 30, drafts);
const waiting = draftsWaiting(loaded.rows);
const whyNone =
  loaded.why ??
  (limit <= 0
    ? "REAL_ASKS_LIMIT is 0"
    : `no real ask has been reviewed yet: ${waiting} draft${waiting === 1 ? " is" : "s are"} waiting for review in the Braintrust dataset "${DATASET}". Set a row's metadata.review to "reviewed" to run it, or set REAL_ASKS_RUN_DRAFTS=1 to run the drafts by hand`);
if (rows.length > 0 && waiting > 0 && !drafts) console.log(`Real asks: ${rows.length} reviewed row${rows.length === 1 ? "" : "s"} to run; ${waiting} draft${waiting === 1 ? " is" : "s are"} waiting for review in Braintrust and will not run.`);

export default rows.length === 0
  ? [
      defineEval({
        description: "real asks: none to run",
        tags: ["real"],
        async test(t) {
          t.skip(whyNone ?? "there are no real asks to run");
        },
      }),
    ]
  : rows.map((row) =>
      defineEval({
        // The name carries the row's id and never the ask, so a console line or a Slack message quotes no shopper.
        description: `real ask ${row.id} (${row.kind}, ${row.review === REVIEWED ? "reviewed" : "draft requirements"})`,
        tags: ["real", row.review === REVIEWED ? "real-reviewed" : "real-draft"],
        // `messages` becomes the row's input in Braintrust. There is no `ask` here, which is what the Slack report prints.
        metadata: { messages: row.messages, dataset_row: row.id, picked_for: row.pickedFor, day: row.day },
        async test(t) {
          const [first, ...rest] = row.messages;
          let turn = await t.send(first!);
          // The earlier messages only set the scene: their cards are kept, since the last message may be answered from them.
          let earlier: Card[] = [];
          for (const message of rest) {
            earlier = [...earlier, ...cardsShown(turn)];
            turn = await turn.session.send(message);
          }
          t.succeeded();
          const last = row.messages.at(-1)!;
          if (rest.length === 0) turn.calledTool("buy");
          checkWordsUnchanged(t, turn, last, false);
          await checkAnswer(
            t,
            turn,
            {
              ask: rest.length === 0 ? last : row.messages.map((message, index) => `Message ${index + 1}: ${message}`).join(" "),
              wants: row.wants,
              mayAsk: row.mayAsk,
              priced: row.priced,
              context: row.context,
            },
            earlier,
          );
        },
      }),
    );
