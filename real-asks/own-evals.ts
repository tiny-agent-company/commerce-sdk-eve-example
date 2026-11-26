import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { words } from "./scrub.ts";

/**
 * The messages this repository's own evals send, read from the eval files: every `ask: "..."`, every entry of a
 * `messages: [...]` list and every `send("...")`.
 *
 * The evals talk to the live buy tool, so their conversations sit in the same database the job reads. They are kept
 * out three ways. They run with test-mode credentials, and test mode is never read. Their client's id belongs on
 * REAL_ASKS_SKIP_CLIENTS. And, whatever company or client they arrive through, a conversation that opens with one of
 * these messages word for word is left out here. A real shopper who types exactly what an eval sends is left out too,
 * which loses nothing: that ask is already an eval.
 */
export function ownEvalAsks(folder = join(import.meta.dirname, "..", "evals")): Set<string> {
  const asks = new Set<string>();
  const text = /"((?:[^"\\]|\\.)*)"/g;
  const keep = (literal: string) => {
    const said = words(literal.replace(/\\(.)/g, "$1")).join(" ");
    if (said) asks.add(said);
  };
  const read = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) read(path);
      else if (entry.name.endsWith(".eval.ts")) {
        const source = readFileSync(path, "utf8");
        for (const found of source.matchAll(/\bask:\s*"((?:[^"\\]|\\.)*)"/g)) keep(found[1]!);
        for (const found of source.matchAll(/\bsend\(\s*"((?:[^"\\]|\\.)*)"/g)) keep(found[1]!);
        for (const list of source.matchAll(/\bmessages:\s*\[([^\]]*)\]/g)) for (const found of list[1]!.matchAll(text)) keep(found[1]!);
      }
    }
  };
  read(folder);
  return asks;
}

/** True when the message is, word for word, one this repository's evals send. */
export function isOwnEvalAsk(message: string, asks: Set<string>): boolean {
  return asks.has(words(message).join(" "));
}
