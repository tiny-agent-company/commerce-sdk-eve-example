/**
 * A dropped connection is retried once, and a message is never sent twice.
 *
 * An eval talks to the chat app over a connection that can drop: on 2026-11-26 one eval failed on its very first
 * message with `read ECONNRESET`, which says nothing about Agentcard. So:
 *
 * - The first message of a chat is sent again in a fresh chat. Nothing was under way, so nothing can happen twice.
 * - A later message is never sent again. A "yes" sent twice could be read as two orders. The eval connects to the same
 *   chat again and reads on from where it was: when the message did arrive, its answer is there to read.
 * - When it never arrived, that chat is given up, and the whole chat runs once more from its first message in a fresh
 *   chat (`chatAgainOnce`). This is safe because no eval ever places an order: they run with sandbox credentials, where
 *   every yes stops at the payment. Only a second chat that also drops is reported as broken, which is the run's own
 *   result ("run broke"), not Agentcard's failure. On 2026-11-27 one rental car run of 381 lost its connection this way.
 */

/** The chat as this file needs it, so the rule can be tested without a chat app. */
export interface Chat<Turn> {
  /** Opens a new chat with its first message. */
  open(message: string): Promise<Turn>;
  /** Sends the next message in the chat under way. */
  send(message: string): Promise<Turn>;
  /**
   * Connects to the chat under way again and reads the answer to `message` without sending anything. Null when the
   * message never arrived there.
   */
  readAgain(message: string): Promise<Turn | null>;
}

/** The chat could not be kept: the connection dropped, and the one retry did not bring an answer. */
export class ChatBroke extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatBroke";
  }
}

const words = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * Sends one message and returns its answer, retrying once when the connection drops. `first` is true for the message
 * that opens the chat. `note` hears what was retried, for the eval's log.
 */
export async function deliver<Turn>(chat: Chat<Turn>, message: string, first: boolean, note: (line: string) => void = () => {}): Promise<Turn> {
  try {
    return first ? await chat.open(message) : await chat.send(message);
  } catch (error) {
    if (first) {
      note(`the connection dropped on the first message (${words(error)}): sending it once more in a fresh chat`);
      try {
        return await chat.open(message);
      } catch (again) {
        throw new ChatBroke(`the connection dropped on the first message, and again in a fresh chat: ${words(again)}`);
      }
    }
    note(`the connection dropped after a later message (${words(error)}): reading the same chat again, without sending the message a second time`);
    let turn: Turn | null;
    try {
      turn = await chat.readAgain(message);
    } catch (again) {
      throw new ChatBroke(`the connection dropped, and the same chat could not be read again: ${words(again)}`);
    }
    if (turn === null) throw new ChatBroke("the connection dropped before the message arrived in the chat. It is not sent a second time, so a yes can never be sent twice");
    return turn;
  }
}

/** The log line that says the chat runs again from its first message. What was recorded before it belongs to the chat given up. */
export const CHAT_AGAIN = "CHAT AGAIN ";

/**
 * Runs a whole chat, and runs it once more from its first message when its connection broke (`broke` set). Returns the
 * second chat when there was one. `note` hears a line for the eval's log, which starts with CHAT_AGAIN.
 */
export async function chatAgainOnce<T extends { broke: string | null }>(chat: () => Promise<T>, note: (line: string) => void = () => {}): Promise<T> {
  const first = await chat();
  if (first.broke === null) return first;
  note(`${CHAT_AGAIN}the connection broke (${first.broke}), so the whole chat runs once more from its first message, in a fresh chat`);
  return chat();
}

/** The lines logged by the last chat a run had: everything after the last CHAT_AGAIN line, or every line when there is none. */
export function linesOfLastChat(lines: readonly string[]): readonly string[] {
  let at = -1;
  lines.forEach((line, index) => {
    if (line.startsWith(CHAT_AGAIN)) at = index;
  });
  return at < 0 ? lines : lines.slice(at + 1);
}
