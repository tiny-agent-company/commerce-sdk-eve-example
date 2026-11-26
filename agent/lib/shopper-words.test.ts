import assert from "node:assert/strict";
import { test } from "node:test";
import { askToSend, type ChatMessage } from "./shopper-words.ts";

const shopper = "hey so my blender just died, can you find me a decent one that can crush ice? nothing fancy";
const reworded = "find me a decent blender that can crush ice, nothing fancy";

test("the buy tool sends the shopper's words, not the model's rewording of them", () => {
  const messages: ChatMessage[] = [{ role: "user", content: shopper }];
  assert.equal(askToSend(messages, reworded), shopper);
});

test("the shopper's words in text parts are sent, and a picture beside them is left out", () => {
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "image" }, { type: "text", text: "  this lamp but in white " }] }];
  assert.equal(askToSend(messages, "white version of the lamp in the photo"), "this lamp but in white");
});

test("the latest message is the one sent, not an earlier one", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "a backpack" },
    { role: "assistant", content: [{ type: "tool-call", toolName: "buy" }] },
    { role: "tool", content: [{ type: "tool-result" }] },
    { role: "assistant", content: "here are some backpacks" },
    { role: "user", content: "a waterproof one for hiking, under $50" },
  ];
  assert.equal(askToSend(messages, "waterproof hiking backpack under $50"), "a waterproof one for hiking, under $50");
});

test("a second call of the buy tool for the same message keeps the model's words", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: shopper },
    { role: "assistant", content: [{ type: "text", text: "on it" }, { type: "tool-call", toolName: "buy" }] },
    { role: "tool", content: [{ type: "tool-result" }] },
  ];
  assert.equal(askToSend(messages, "countertop blender"), "countertop blender");
});

test("another tool's call before this one leaves the shopper's words in place", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: shopper },
    { role: "assistant", content: [{ type: "tool-call", toolName: "web_search" }] },
    { role: "tool", content: [{ type: "tool-result" }] },
  ];
  assert.equal(askToSend(messages, reworded), shopper);
});

test("a picture with no words, or no message at all, keeps the model's words", () => {
  assert.equal(askToSend([{ role: "user", content: [{ type: "image" }] }], "a lamp like this one"), "a lamp like this one");
  assert.equal(askToSend([], "a lamp"), "a lamp");
});
