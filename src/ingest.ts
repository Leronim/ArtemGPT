import { readFileSync } from "node:fs";
import { addReply, addReplyPair, recordMessage } from "./style/replyBank.js";
import { cleanText } from "./style/text.js";

type JsonMessage = {
  id?: number | string;
  from_id?: string;
  from?: string;
  text?: string | Array<string | { text?: string }>;
  reply_to_message_id?: number | string;
  date?: string;
};

function messageText(raw: JsonMessage): string {
  if (typeof raw.text === "string") return raw.text;
  if (Array.isArray(raw.text)) {
    return raw.text.map((part) => (typeof part === "string" ? part : part.text ?? "")).join("");
  }
  return "";
}

function loadMessages(filePath: string): JsonMessage[] {
  const json = JSON.parse(readFileSync(filePath, "utf8")) as { messages?: JsonMessage[] } | JsonMessage[];
  return Array.isArray(json) ? json : json.messages ?? [];
}

const filePath = process.argv[2];
if (!filePath) {
  throw new Error("Usage: npm run ingest -- path/to/result.json");
}

const chatId = process.argv[3] ?? "import";
const messages = loadMessages(filePath);
const byId = new Map<string, string>();
let replies = 0;
let pairs = 0;

for (const message of messages) {
  const text = cleanText(messageText(message));
  const messageId = message.id == null ? undefined : String(message.id);
  const userId = message.from_id ?? message.from;
  if (!text || !messageId) continue;

  byId.set(messageId, text);
  recordMessage({
    chatId,
    userId,
    messageId,
    text,
    replyToMessageId: message.reply_to_message_id == null ? undefined : String(message.reply_to_message_id),
  });

  if (addReply({
    replyText: text,
    source: "import",
    sourceChatId: chatId,
    sourceUserId: userId,
    sourceMessageId: messageId,
    metadata: { importedAt: new Date().toISOString(), originalDate: message.date },
  })) {
    replies += 1;
  }

  if (message.reply_to_message_id != null) {
    const trigger = byId.get(String(message.reply_to_message_id));
    if (trigger && addReplyPair({
      triggerText: trigger,
      replyText: text,
      source: "import",
      sourceChatId: chatId,
      sourceUserId: userId,
    })) {
      pairs += 1;
    }
  }
}

console.log(`imported messages: ${messages.length}`);
console.log(`reply bank added/updated: ${replies}`);
console.log(`reply pairs added/updated: ${pairs}`);
