/**
 * The words the buy tool sends to Agentcard as `ask`.
 *
 * The model is told to pass the shopper's message word for word, and it does not always: on 2026-11-26 it sent "find me a
 * decent blender that can crush ice, nothing fancy" for "hey so my blender just died, can you find me a decent one that can
 * crush ice? nothing fancy", and Agentcard searched the model's words. The tool's own description asks it to say in its
 * first line what it is about to look for "in their own words", which is a short summary, and the model carries that
 * summary into `ask`. So the tool reads the shopper's message from the chat itself and sends that.
 *
 * Only the first call of the tool for a message sends the shopper's words. A later call in the same reply is the model's
 * own follow-up, such as a second search after the first found nothing, and the words it chose stay, since sending the
 * shopper's message again would ask Agentcard the same thing twice.
 */

/** One message of the chat as eve hands it to a tool (`ctx.messages`), reduced to what this file reads. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ReadonlyArray<{ type: string; text?: string; toolName?: string }>;
}

/** The text a message carries: its string, or its text parts joined. Pictures and files carry none. */
function textOf(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * The shopper's latest message, as they typed it, when this is the first call of `tool` since that message; null otherwise,
 * and null when the message carries no words, such as a picture alone.
 */
export function shopperWordsForCall(messages: readonly ChatMessage[], tool = "buy"): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "assistant" && typeof message.content !== "string" && message.content.some((part) => part.type === "tool-call" && part.toolName === tool)) {
      return null;
    }
    if (message.role === "user") {
      const words = textOf(message).trim();
      return words === "" ? null : words;
    }
  }
  return null;
}

/** The `ask` to send: the shopper's own words on the first call for their message, the model's words otherwise. */
export function askToSend(messages: readonly ChatMessage[], modelAsk: string, tool = "buy"): string {
  return shopperWordsForCall(messages, tool) ?? modelAsk;
}
