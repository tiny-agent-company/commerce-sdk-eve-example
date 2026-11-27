/**
 * A dropped connection is retried once, and a message is never sent twice.
 *
 * An eval talks to the chat app over a connection that can drop: on 2026-11-26 one eval failed on its very first
 * message with `read ECONNRESET`, which says nothing about Agentcard. So:
 *
 * - The first message of a chat is sent again in a fresh chat. Nothing was under way, so nothing can happen twice.
 * - A later message is never sent again. A "yes" sent twice could be read as two orders. The eval connects to the same
 *   chat again and reads on from where it was: when the message did arrive, its answer is there to read, and when it
 *   never arrived the chat is given up as broken, which is reported as the run's own failure, not Agentcard's.
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
