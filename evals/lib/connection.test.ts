import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatBroke, deliver, type Chat } from "./connection.ts";

/** A chat that fails as told and counts what was sent. */
function chat(plan: { open?: (number | "ok")[]; send?: "drops" | "ok"; arrived?: boolean }) {
  const sent: string[] = [];
  let opens = 0;
  const made: Chat<string> = {
    open: async (message) => {
      sent.push(`open: ${message}`);
      if ((plan.open ?? ["ok"])[opens++] !== "ok") throw new Error("read ECONNRESET");
      return `answer to ${message}`;
    },
    send: async (message) => {
      sent.push(`send: ${message}`);
      if (plan.send === "drops") throw new Error("read ECONNRESET");
      return `answer to ${message}`;
    },
    readAgain: async (message) => (plan.arrived ? `answer to ${message}, read again` : null),
  };
  return { made, sent };
}

test("a message that goes through is sent once", async () => {
  const { made, sent } = chat({});
  assert.equal(await deliver(made, "a box of crayons", true), "answer to a box of crayons");
  assert.deepEqual(sent, ["open: a box of crayons"]);
});

test("a first message whose connection drops is sent once more, in a fresh chat", async () => {
  const { made, sent } = chat({ open: [0, "ok"] });
  assert.equal(await deliver(made, "a box of crayons", true), "answer to a box of crayons");
  assert.deepEqual(sent, ["open: a box of crayons", "open: a box of crayons"]);
});

test("a first message that drops twice gives the chat up", async () => {
  const { made, sent } = chat({ open: [0, 0, "ok"] });
  await assert.rejects(deliver(made, "a box of crayons", true), ChatBroke);
  assert.equal(sent.length, 2);
});

test("a yes whose connection drops is never sent twice: its answer is read from the same chat", async () => {
  const { made, sent } = chat({ send: "drops", arrived: true });
  assert.equal(await deliver(made, "yes", false), "answer to yes, read again");
  assert.deepEqual(sent, ["send: yes"]);
});

test("a later message that never arrived is not sent again, and the chat is given up", async () => {
  const { made, sent } = chat({ send: "drops", arrived: false });
  await assert.rejects(deliver(made, "yes", false), /not sent a second time/);
  assert.deepEqual(sent, ["send: yes"]);
});
