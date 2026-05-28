import { v4 as uuidv4 } from "uuid";
import { db, nowIso } from "../db/index.js";
import { canUseAsPairTrigger, canUseAsReply, classifyReply, cleanText, normalizedHash, normalizeText } from "./text.js";

export type ReplySource = "import" | "target_chat" | "bot_good" | "manual";

type AddReplyInput = {
  replyText: string;
  source: ReplySource;
  sourceChatId?: string;
  sourceUserId?: string;
  sourceMessageId?: string;
  approved?: boolean;
  metadata?: unknown;
};

export function addReply(input: AddReplyInput): string | null {
  if (!canUseAsReply(input.replyText)) return null;
  const clean = cleanText(input.replyText);
  const hash = normalizedHash(clean);
  const existing = db.prepare("SELECT id FROM reply_bank WHERE normalized_hash = ?").get(hash) as { id: string } | undefined;
  const now = nowIso();
  const classification = classifyReply(clean);

  if (existing) {
    db.prepare(`
      UPDATE reply_bank
      SET updated_at = ?, approved = MAX(approved, ?), weight = weight + 0.05
      WHERE id = ?
    `).run(now, input.approved ? 1 : 0, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO reply_bank (
      id, reply_text, clean_reply_text, normalized_hash, source, source_chat_id, source_user_id,
      source_message_id, category, intent, approved, created_at, updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    clean,
    normalizeText(clean),
    hash,
    input.source,
    input.sourceChatId ?? null,
    input.sourceUserId ?? null,
    input.sourceMessageId ?? null,
    classification.category,
    classification.intent,
    input.approved ? 1 : 0,
    now,
    now,
    input.metadata == null ? null : JSON.stringify(input.metadata),
  );
  return id;
}

export function addReplyPair(input: {
  triggerText: string;
  replyText: string;
  source: ReplySource;
  sourceChatId?: string;
  sourceUserId?: string;
  approved?: boolean;
}): string | null {
  if (!canUseAsPairTrigger(input.triggerText)) return null;
  const replyId = addReply(input);
  if (!replyId) return null;
  const now = nowIso();
  const existing = db.prepare(`
    SELECT id FROM reply_pairs
    WHERE clean_trigger_text = ? AND reply_id = ?
  `).get(normalizeText(input.triggerText), replyId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE reply_pairs
      SET updated_at = ?, approved = MAX(approved, ?), weight = weight + 0.05
      WHERE id = ?
    `).run(now, input.approved ? 1 : 0, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO reply_pairs (
      id, trigger_text, clean_trigger_text, reply_id, reply_text, source, source_chat_id,
      source_user_id, approved, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cleanText(input.triggerText),
    normalizeText(input.triggerText),
    replyId,
    cleanText(input.replyText),
    input.source,
    input.sourceChatId ?? null,
    input.sourceUserId ?? null,
    input.approved ? 1 : 0,
    now,
    now,
  );
  return id;
}

export function recordMessage(input: {
  chatId: string;
  userId?: string;
  messageId?: string;
  text: string;
  replyToMessageId?: string;
}): void {
  if (!input.text) return;
  db.prepare(`
    INSERT OR IGNORE INTO messages (id, chat_id, user_id, message_id, text, reply_to_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    input.chatId,
    input.userId ?? null,
    input.messageId ?? null,
    cleanText(input.text),
    input.replyToMessageId ?? null,
    nowIso(),
  );
}

export function learnFromStyleMessage(input: {
  chatId: string;
  userId: string;
  messageId: string;
  text: string;
  replyToMessageId?: string;
}): void {
  const replyId = addReply({
    replyText: input.text,
    source: "target_chat",
    sourceChatId: input.chatId,
    sourceUserId: input.userId,
    sourceMessageId: input.messageId,
  });
  if (!replyId || !input.replyToMessageId) return;

  const trigger = db.prepare(`
    SELECT text FROM messages
    WHERE chat_id = ? AND message_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(input.chatId, input.replyToMessageId) as { text: string } | undefined;

  if (trigger) {
    addReplyPair({
      triggerText: trigger.text,
      replyText: input.text,
      source: "target_chat",
      sourceChatId: input.chatId,
      sourceUserId: input.userId,
    });
  }
}

export function recordBotResponse(input: {
  chatId: string;
  userId?: string;
  userMessageId?: string;
  userMessageText: string;
  botMessageId?: string;
  botResponseText: string;
}): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO bot_response_history (
      id, chat_id, user_id, user_message_id, user_message_text, bot_message_id,
      bot_response_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.chatId,
    input.userId ?? null,
    input.userMessageId ?? null,
    cleanText(input.userMessageText),
    input.botMessageId ?? null,
    cleanText(input.botResponseText),
    nowIso(),
  );
  return id;
}

export function approveBotResponse(chatId: string, botMessageId: string): boolean {
  const history = db.prepare(`
    SELECT * FROM bot_response_history
    WHERE chat_id = ? AND bot_message_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(chatId, botMessageId) as { id: string; user_id: string | null; user_message_text: string; bot_response_text: string } | undefined;
  if (!history) return false;

  const replyId = addReply({
    replyText: history.bot_response_text,
    source: "bot_good",
    sourceChatId: chatId,
    sourceUserId: history.user_id ?? undefined,
    sourceMessageId: botMessageId,
    approved: true,
  });
  if (!replyId) return false;

  addReplyPair({
    triggerText: history.user_message_text,
    replyText: history.bot_response_text,
    source: "bot_good",
    sourceChatId: chatId,
    sourceUserId: history.user_id ?? undefined,
    approved: true,
  });

  db.prepare("UPDATE bot_response_history SET was_approved = 1 WHERE id = ?").run(history.id);
  db.prepare("UPDATE reply_bank SET success_count = success_count + 1, weight = weight + 0.3 WHERE id = ?").run(replyId);
  return true;
}

export function rejectBotResponse(chatId: string, botMessageId: string): boolean {
  const history = db.prepare(`
    SELECT * FROM bot_response_history
    WHERE chat_id = ? AND bot_message_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(chatId, botMessageId) as { id: string; bot_response_text: string } | undefined;
  if (!history) return false;

  db.prepare("UPDATE bot_response_history SET was_rejected = 1 WHERE id = ?").run(history.id);
  db.prepare(`
    UPDATE reply_bank
    SET fail_count = fail_count + 1, weight = MAX(0, weight - 0.5), updated_at = ?
    WHERE normalized_hash = ?
  `).run(nowIso(), normalizedHash(history.bot_response_text));
  return true;
}

export function applyBotResponseReaction(input: {
  chatId: string;
  botMessageId: string;
  userId: string;
  emoji: string;
  kind: "positive" | "negative";
}): "approved" | "rejected" | "duplicate" | "not_found" {
  const exists = db.prepare(`
    SELECT id FROM bot_response_reactions
    WHERE chat_id = ? AND bot_message_id = ? AND user_id = ?
  `).get(input.chatId, input.botMessageId, input.userId) as { id: string } | undefined;

  if (exists) return "duplicate";

  const applied = input.kind === "positive"
    ? approveBotResponse(input.chatId, input.botMessageId)
    : rejectBotResponse(input.chatId, input.botMessageId);

  if (!applied) return "not_found";

  db.prepare(`
    INSERT INTO bot_response_reactions (id, chat_id, bot_message_id, user_id, reaction_kind, emoji, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.chatId, input.botMessageId, input.userId, input.kind, input.emoji, nowIso());

  return input.kind === "positive" ? "approved" : "rejected";
}

export function forgetReplyByText(text: string): boolean {
  const result = db.prepare("DELETE FROM reply_bank WHERE normalized_hash = ?").run(normalizedHash(text));
  return result.changes > 0;
}

export function getReplyStats(): Record<string, number> {
  const scalar = (sql: string): number => (db.prepare(sql).get() as { count: number }).count;
  return {
    replyBank: scalar("SELECT COUNT(*) AS count FROM reply_bank"),
    replyPairs: scalar("SELECT COUNT(*) AS count FROM reply_pairs"),
    approved: scalar("SELECT COUNT(*) AS count FROM reply_bank WHERE approved = 1"),
    botLearned: scalar("SELECT COUNT(*) AS count FROM reply_bank WHERE source = 'bot_good'"),
    manual: scalar("SELECT COUNT(*) AS count FROM reply_bank WHERE source = 'manual'"),
  };
}

export function getRecentChatContext(chatId: string, limit = 12): string {
  const rows = db.prepare(`
    SELECT role, text FROM chat_context
    WHERE chat_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(chatId, limit) as Array<{ role: string; text: string }>;
  return rows.reverse().map((row) => `${row.role}: ${row.text}`).join("\n");
}

export function addChatContext(input: { chatId: string; userId?: string; messageId?: string; text: string; role: "user" | "bot" }): void {
  db.prepare(`
    INSERT INTO chat_context (id, chat_id, user_id, message_id, text, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.chatId, input.userId ?? null, input.messageId ?? null, cleanText(input.text), input.role, nowIso());
}
