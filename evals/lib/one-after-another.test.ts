import assert from "node:assert/strict";
import { test } from "node:test";
import { chatsAtOnce, limitFor, oneAfterAnother, repeats } from "./one-after-another.ts";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the runs of one eval go one after another, and runs of another eval go beside them", async () => {
  const seen: string[] = [];
  const run = (key: string, name: string) =>
    oneAfterAnother(key, 5_000, async () => {
      seen.push(`${name} starts`);
      await pause(20);
      seen.push(`${name} ends`);
      return name;
    });
  const results = await Promise.all([run("cart: Wayfair", "wayfair 1"), run("cart: Wayfair", "wayfair 2"), run("cart: eBay", "ebay 1"), run("cart: Wayfair", "wayfair 3")]);
  assert.deepEqual(results, ["wayfair 1", "wayfair 2", "ebay 1", "wayfair 3"]);
  const at = (line: string) => seen.indexOf(line);
  assert.ok(at("wayfair 1 ends") < at("wayfair 2 starts"));
  assert.ok(at("wayfair 2 ends") < at("wayfair 3 starts"));
  assert.ok(at("ebay 1 starts") < at("wayfair 1 ends"), "another eval's run does not wait");
});

test("a run that fails still lets the next one start", async () => {
  const first = oneAfterAnother("checkout: Lowe's", 5_000, async () => {
    throw new Error("the store broke");
  });
  const second = oneAfterAnother("checkout: Lowe's", 5_000, async () => "second ran");
  await assert.rejects(first);
  assert.equal(await second, "second ran");
});

test("a run that hangs holds the next one back no longer than its own limit", async () => {
  let hung = true;
  void oneAfterAnother("cart: TikTok Shop", 30, async () => {
    while (hung) await pause(10);
  });
  const started = Date.now();
  await oneAfterAnother("cart: TikTok Shop", 30, async () => {});
  hung = false;
  assert.ok(Date.now() - started < 1_000);
});

test("the number of runs is read from the command line, and an eval's limit grows with it", () => {
  assert.equal(repeats(["node", "eve", "eval", "--tag", "cart", "--repeat", "3"]), 3);
  assert.equal(repeats(["node", "eve", "eval", "--repeat=2"]), 2);
  assert.equal(repeats(["node", "eve", "eval", "--tag", "cart"]), 1);
  assert.equal(repeats(["node", "eve", "eval", "--repeat", "many"]), 1);
  assert.equal(limitFor(1_200_000, ["eve", "eval", "--repeat", "3", "--max-concurrency", "2"]), 3_600_000);
  assert.equal(limitFor(1_200_000, ["eve", "eval", "--repeat", "3", "--max-concurrency", "6"]), 7_200_000);
  assert.equal(limitFor(1_200_000, ["eve", "eval"]), 4_800_000, "evals.config.ts holds four at once");
});

test("no more than two purchase chats run at once, whatever eval they belong to", async () => {
  assert.equal(chatsAtOnce({}), 2);
  assert.equal(chatsAtOnce({ PURCHASE_CHATS_AT_ONCE: "1" }), 1);
  assert.equal(chatsAtOnce({ PURCHASE_CHATS_AT_ONCE: "lots" }), 2);
  let now = 0;
  let most = 0;
  const run = (key: string) =>
    oneAfterAnother(key, 5_000, async () => {
      now++;
      most = Math.max(most, now);
      await pause(15);
      now--;
    });
  await Promise.all(["a", "b", "c", "d", "e", "a", "b"].map((key) => run(`at once: ${key}`)));
  assert.equal(most, 2);
});
