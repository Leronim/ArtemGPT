import { v4 as uuidv4 } from "uuid";
import { db, nowIso } from "../db/index.js";
import { canUseAsPairTrigger, canUseAsReply, classifyReply, cleanLearnedText, cleanText, looksLikeGibberish, normalizedHash, normalizeText } from "./text.js";

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
  const clean = cleanLearnedText(input.replyText);
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
    cleanLearnedText(input.triggerText),
    normalizeText(input.triggerText),
    replyId,
    cleanLearnedText(input.replyText),
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
    cleanLearnedText(input.text),
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
    cleanLearnedText(input.userMessageText),
    input.botMessageId ?? null,
    cleanLearnedText(input.botResponseText),
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

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.floor(maxLength * 0.65)).trim()}\n...\n${text.slice(-Math.floor(maxLength * 0.3)).trim()}`;
}

function refreshChatSummary(chatId: string): void {
  const rows = db.prepare(`
    SELECT role, text FROM chat_context
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT 40
  `).all(chatId) as Array<{ role: string; text: string }>;
  if (rows.length < 18) return;

  const older = rows.reverse().slice(0, -8);
  const summary = truncateMiddle(older.map((row) => `${row.role}: ${row.text}`).join("\n"), 1200);
  db.prepare(`
    INSERT INTO chat_summaries (chat_id, summary_text, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET summary_text = excluded.summary_text, updated_at = excluded.updated_at
  `).run(chatId, summary, nowIso());
}

export function getRecentChatContext(chatId: string, limit = 8): string {
  const summary = db.prepare("SELECT summary_text FROM chat_summaries WHERE chat_id = ?").get(chatId) as { summary_text: string } | undefined;
  const rows = db.prepare(`
    SELECT role, text FROM chat_context
    WHERE chat_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(chatId, limit) as Array<{ role: string; text: string }>;
  const recent = rows.reverse().map((row) => `${row.role}: ${row.text}`).join("\n");
  if (!summary?.summary_text) return recent;
  return `Краткая память чата:\n${summary.summary_text}\n\nПоследние сообщения:\n${recent}`;
}

export function addChatContext(input: { chatId: string; userId?: string; messageId?: string; text: string; role: "user" | "bot" }): void {
  const text = cleanLearnedText(input.text);
  if (!text) return;
  db.prepare(`
    INSERT INTO chat_context (id, chat_id, user_id, message_id, text, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.chatId, input.userId ?? null, input.messageId ?? null, text, input.role, nowIso());
  refreshChatSummary(input.chatId);
}

export function secondsSinceLastBotReply(chatId: string): number | null {
  const row = db.prepare(`
    SELECT created_at FROM chat_context
    WHERE chat_id = ? AND role = 'bot'
    ORDER BY created_at DESC LIMIT 1
  `).get(chatId) as { created_at: string } | undefined;
  if (!row) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(row.created_at)) / 1000));
}

export function cleanupReplyBank(): Record<string, number> {
  sanitizeLearnedMentions();
  const badBank = db.prepare("DELETE FROM reply_bank WHERE fail_count >= 3 OR LENGTH(clean_reply_text) < 2").run().changes;
  const badPairs = db.prepare(`
    DELETE FROM reply_pairs
    WHERE fail_count >= 3
       OR LENGTH(clean_trigger_text) < 2
       OR LENGTH(reply_text) < 2
       OR reply_id NOT IN (SELECT id FROM reply_bank)
  `).run().changes;

  let gibberish = 0;
  const rows = db.prepare("SELECT id, reply_text FROM reply_bank").all() as Array<{ id: string; reply_text: string }>;
  for (const row of rows) {
    if (looksLikeGibberish(row.reply_text)) {
      gibberish += db.prepare("DELETE FROM reply_bank WHERE id = ?").run(row.id).changes;
    }
  }

  db.exec("INSERT INTO reply_bank_fts(reply_bank_fts) VALUES('rebuild'); INSERT INTO reply_pairs_fts(reply_pairs_fts) VALUES('rebuild');");
  return { badBank, badPairs, gibberish };
}

export function sanitizeLearnedMentions(): void {
  const now = nowIso();
  const bankRows = db.prepare("SELECT id, reply_text FROM reply_bank WHERE reply_text LIKE '%@%'").all() as Array<{ id: string; reply_text: string }>;
  for (const row of bankRows) {
    const cleaned = cleanLearnedText(row.reply_text);
    if (!cleaned || cleaned === row.reply_text) continue;
    const hash = normalizedHash(cleaned);
    const duplicate = db.prepare("SELECT id FROM reply_bank WHERE normalized_hash = ? AND id != ?").get(hash, row.id) as { id: string } | undefined;
    if (duplicate) {
      db.prepare("DELETE FROM reply_bank WHERE id = ?").run(row.id);
      continue;
    }
    db.prepare(`
      UPDATE reply_bank
      SET reply_text = ?, clean_reply_text = ?, normalized_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(cleaned, normalizeText(cleaned), hash, now, row.id);
  }

  const pairRows = db.prepare("SELECT id, trigger_text, reply_text FROM reply_pairs WHERE trigger_text LIKE '%@%' OR reply_text LIKE '%@%'").all() as Array<{ id: string; trigger_text: string; reply_text: string }>;
  for (const row of pairRows) {
    const trigger = cleanLearnedText(row.trigger_text);
    const reply = cleanLearnedText(row.reply_text);
    if (!trigger || !reply) continue;
    db.prepare(`
      UPDATE reply_pairs
      SET trigger_text = ?, clean_trigger_text = ?, reply_text = ?, updated_at = ?
      WHERE id = ?
    `).run(trigger, normalizeText(trigger), reply, now, row.id);
  }

  const textTables = [
    { table: "messages", columns: ["text"] },
    { table: "chat_context", columns: ["text"] },
    { table: "bot_response_history", columns: ["user_message_text", "bot_response_text"] },
  ];

  for (const item of textTables) {
    for (const column of item.columns) {
      const rows = db.prepare(`SELECT id, ${column} AS text FROM ${item.table} WHERE ${column} LIKE '%@%'`).all() as Array<{ id: string; text: string }>;
      for (const row of rows) {
        const cleaned = cleanLearnedText(row.text);
        if (!cleaned || cleaned === row.text) continue;
        db.prepare(`UPDATE ${item.table} SET ${column} = ? WHERE id = ?`).run(cleaned, row.id);
      }
    }
  }
}
