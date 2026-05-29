import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { db, nowIso } from "../db/index.js";
import { canUseAsPairTrigger, canUseAsReply, classifyReply, cleanLearnedText, cleanText, containsPrivateData, looksLikeGibberish, normalizedHash, normalizeText } from "./text.js";

export type ReplySource = "import" | "target_chat" | "bot_good" | "manual";

let lastContextPruneAt = 0;

const topicPatterns: Array<[string, RegExp]> = [
  ["деньги", /(деньг|курс|евро|доллар|битк|крипт|акци|инвест)/i],
  ["техника", /(код|сервер|бот|деплой|api|ошибк|баг|github|впс|vps|ollama)/i],
  ["машины", /(машин|тачк|мотор|двиг|бмв|мерс|авто)/i],
  ["аниме", /(аниме|манг|серия|тян)/i],
  ["игры", /(игр|стим|steam|катк|матч)/i],
  ["работа", /(работ|созвон|таск|проект|дедлайн)/i],
];

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function uniqueLimit(items: string[], limit: number): string[] {
  return [...new Set(items.map((item) => cleanLearnedText(item)).filter(Boolean))].slice(0, limit);
}

function extractTopics(text: string): string[] {
  return topicPatterns.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function extractSafeFacts(text: string): string[] {
  const clean = cleanLearnedText(text);
  if (containsPrivateData(clean) || clean.length > 180) return [];
  const facts: string[] = [];
  const nameMatch = clean.match(/\b(?:меня\s+зовут|это)\s+([А-ЯЁA-Z][а-яёa-z-]{1,30})\b/i);
  if (nameMatch?.[1]) facts.push(`имя: ${nameMatch[1]}`);
  const likesMatch = clean.match(/\b(?:люблю|нравится|интересно|шарю за)\s+(.{3,60})/i);
  if (likesMatch?.[1]) facts.push(`интерес: ${likesMatch[1]}`);
  return facts;
}

function isUserIdentityQuestion(text: string): boolean {
  const clean = cleanText(text).toLowerCase().replace(/ё/g, "е");
  return /(как|кто).{0,20}(меня|мне).{0,20}(зовут|имя)|как.{0,20}мое.{0,10}имя|ты.{0,20}помнишь.{0,20}(меня|мое имя|как меня зовут)|кто я\b/i.test(clean);
}

function getExplicitUserName(facts: string[]): string | null {
  const fact = facts.find((item) => /^имя:\s*\S+/i.test(item));
  return fact?.replace(/^имя:\s*/i, "").trim() || null;
}

function normalizePersonName(value: string): string {
  return cleanText(value).toLowerCase().replace(/ё/g, "е").replace(/^@/, "");
}

function personAliases(name: string): string[] {
  const normalized = normalizePersonName(name);
  const aliases = new Set([normalized]);
  if (normalized === "миша" || normalized === "миха" || normalized === "михаил") {
    aliases.add("миша");
    aliases.add("миха");
    aliases.add("михаил");
  }
  return [...aliases].filter(Boolean);
}

function getPersonNameFromQuestion(text: string): string | null {
  const clean = cleanText(text);
  const lower = normalizePersonName(clean);
  if (!/(^|\s)(кто|знаешь|напомни)(\s|$)/i.test(lower) || !/(^|\s)(чат|чате|тут|такой|такая|это|знаешь|напомни)(\s|$)/i.test(lower)) return null;

  const mention = clean.match(/@([a-zA-Z0-9_]{3,32})/);
  if (mention?.[1]) return mention[1];

  const capitalized = [...clean.matchAll(/(?:^|[\s,?!:;])([А-ЯЁA-Z][а-яёa-z-]{2,30})(?=$|[\s,?!:;])/g)]
    .map((match) => match[1])
    .filter((word) => !/^(Темыч|Telegram)$/i.test(word));
  if (capitalized.length > 0) return capitalized.at(-1) ?? null;

  const stop = new Set(["кто", "такой", "такая", "это", "этом", "чате", "чат", "тут", "знаешь", "напомни"]);
  const words = lower.match(/[а-яa-z0-9_]{3,32}/gi) ?? [];
  return words.filter((word) => !stop.has(word)).at(-1) ?? null;
}

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

export function getRecentBotReplies(chatId: string, limit = 8): string[] {
  const rows = db.prepare(`
    SELECT text FROM chat_context
    WHERE chat_id = ? AND role = 'bot'
    ORDER BY created_at DESC LIMIT ?
  `).all(chatId, limit) as Array<{ text: string }>;
  return rows.map((row) => row.text);
}

export function updateUserMemory(input: {
  chatId: string;
  userId: string;
  displayName?: string;
  text: string;
}): void {
  const clean = cleanLearnedText(input.text);
  if (!clean || clean.startsWith("/") || looksLikeGibberish(clean) || containsPrivateData(clean)) return;

  const existing = db.prepare(`
    SELECT topics_json, facts_json, last_messages_json FROM user_memories
    WHERE chat_id = ? AND user_id = ?
  `).get(input.chatId, input.userId) as { topics_json: string; facts_json: string; last_messages_json: string } | undefined;

  const topics = uniqueLimit([...(existing ? parseJsonArray(existing.topics_json) : []), ...extractTopics(clean)], 12);
  const facts = uniqueLimit([...(existing ? parseJsonArray(existing.facts_json) : []), ...extractSafeFacts(clean)], 12);
  const lastMessages = uniqueLimit([clean, ...(existing ? parseJsonArray(existing.last_messages_json) : [])], 5);

  db.prepare(`
    INSERT INTO user_memories (chat_id, user_id, display_name, topics_json, facts_json, last_messages_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, user_memories.display_name),
      topics_json = excluded.topics_json,
      facts_json = excluded.facts_json,
      last_messages_json = excluded.last_messages_json,
      updated_at = excluded.updated_at
  `).run(
    input.chatId,
    input.userId,
    input.displayName ?? null,
    JSON.stringify(topics),
    JSON.stringify(facts),
    JSON.stringify(lastMessages),
    nowIso(),
  );
}

export function getUserMemory(input: { chatId: string; userId?: string }): string {
  if (!input.userId) return "";
  const row = db.prepare(`
    SELECT display_name, topics_json, facts_json, last_messages_json FROM user_memories
    WHERE chat_id = ? AND user_id = ?
  `).get(input.chatId, input.userId) as { display_name: string | null; topics_json: string; facts_json: string; last_messages_json: string } | undefined;
  if (!row) return "";

  const parts = [
    row.display_name ? `имя/ник: ${row.display_name}` : "",
    parseJsonArray(row.topics_json).length > 0 ? `темы: ${parseJsonArray(row.topics_json).join(", ")}` : "",
    parseJsonArray(row.facts_json).length > 0 ? `факты: ${parseJsonArray(row.facts_json).join("; ")}` : "",
    parseJsonArray(row.last_messages_json).length > 0 ? `последнее: ${parseJsonArray(row.last_messages_json).slice(0, 3).join(" / ")}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

export function getUserMemoryFallbackAnswer(input: { chatId: string; userId?: string; userMessage: string }): string | null {
  if (!input.userId || !isUserIdentityQuestion(input.userMessage)) return null;
  const row = db.prepare(`
    SELECT display_name, facts_json FROM user_memories
    WHERE chat_id = ? AND user_id = ?
  `).get(input.chatId, input.userId) as { display_name: string | null; facts_json: string } | undefined;
  if (!row) return null;

  const name = getExplicitUserName(parseJsonArray(row.facts_json));
  if (name) return `тебя зовут ${name}`;

  return null;
}

export function getChatPersonFallbackAnswer(input: { chatId: string; userMessage: string }): string | null {
  const name = getPersonNameFromQuestion(input.userMessage);
  if (!name) return null;

  const aliases = personAliases(name);
  const rows = db.prepare(`
    SELECT display_name, facts_json, last_messages_json FROM user_memories
    WHERE chat_id = ? AND display_name IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 80
  `).all(input.chatId) as Array<{ display_name: string | null; facts_json: string; last_messages_json: string }>;

  const found = rows.find((row) => {
    const haystack = normalizePersonName([
      row.display_name ?? "",
      ...parseJsonArray(row.facts_json),
      ...parseJsonArray(row.last_messages_json).slice(0, 2),
    ].join(" "));
    return aliases.some((alias) => haystack.includes(alias));
  });

  if (!found?.display_name) return `не помню точно, кто это`;

  const facts = parseJsonArray(found.facts_json).filter((fact) => !/^имя:/i.test(fact)).slice(0, 1);
  return facts.length > 0
    ? `по памяти это ${found.display_name}, ${facts[0]}`
    : `по памяти это ${found.display_name}`;
}

export function addChatContext(input: { chatId: string; userId?: string; messageId?: string; text: string; role: "user" | "bot" }): void {
  const text = cleanLearnedText(input.text);
  if (!text) return;
  db.prepare(`
    INSERT INTO chat_context (id, chat_id, user_id, message_id, text, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.chatId, input.userId ?? null, input.messageId ?? null, text, input.role, nowIso());
  refreshChatSummary(input.chatId);
  pruneOldChatContext();
}

export function pruneOldChatContext(): number {
  if (config.chatContextRetentionDays <= 0) return 0;
  const now = Date.now();
  if (now - lastContextPruneAt < 60_000) return 0;
  lastContextPruneAt = now;
  const cutoff = new Date(Date.now() - config.chatContextRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM chat_context WHERE created_at < ?").run(cutoff).changes;
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
  lastContextPruneAt = 0;
  const oldContext = pruneOldChatContext();
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
  return { badBank, badPairs, gibberish, oldContext };
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
