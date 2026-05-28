import { db } from "../db/index.js";
import { ftsQuery, jaccardSimilarity } from "./text.js";

export type ReplyCandidate = {
  replyText: string;
  triggerText?: string;
  source: string;
  category?: string;
  weight: number;
  approved?: boolean;
  score: number;
};

type PairRow = {
  reply_text: string;
  trigger_text: string;
  source: string;
  category: string | null;
  weight: number;
  success_count: number;
  fail_count: number;
  approved: number;
};

type BankRow = {
  reply_text: string;
  source: string;
  category: string | null;
  weight: number;
  success_count: number;
  fail_count: number;
  approved: number;
};

function scoreCandidate(textSimilarity: number, row: { weight: number; success_count: number; fail_count: number; approved: number }): number {
  const approvedBonus = row.approved ? 0.7 : 0;
  return textSimilarity + row.weight + row.success_count * 0.3 - row.fail_count * 0.7 + approvedBonus;
}

function toDirectScore(score: number): number {
  return Math.max(0, Math.min(0.99, score / 3));
}

export async function retrieveReplyCandidates(input: {
  userMessage: string;
  chatId: string;
  limit: number;
}): Promise<ReplyCandidate[]> {
  const query = ftsQuery(input.userMessage);
  const byKey = new Map<string, ReplyCandidate>();

  const pairRows = db.prepare(`
    SELECT
      p.reply_text, p.trigger_text, p.source,
      b.category,
      p.weight + b.weight AS weight,
      p.success_count + b.success_count AS success_count,
      p.fail_count + b.fail_count AS fail_count,
      MAX(p.approved, b.approved) AS approved
    FROM reply_pairs_fts f
    JOIN reply_pairs p ON p.rowid = f.rowid
    JOIN reply_bank b ON b.id = p.reply_id
    WHERE reply_pairs_fts MATCH ?
      AND (p.source_chat_id IS NULL OR p.source_chat_id = ? OR p.approved = 1)
      AND p.fail_count < 3
      AND b.fail_count < 3
    LIMIT 40
  `).all(query, input.chatId) as PairRow[];

  for (const row of pairRows) {
    const similarity = jaccardSimilarity(input.userMessage, row.trigger_text);
    const score = scoreCandidate(similarity, row);
    byKey.set(row.reply_text, {
      replyText: row.reply_text,
      triggerText: row.trigger_text,
      source: row.source,
      category: row.category ?? undefined,
      weight: row.weight,
      approved: row.approved === 1,
      score: toDirectScore(score),
    });
  }

  const bankRows = db.prepare(`
    SELECT reply_text, source, category, weight, success_count, fail_count, approved
    FROM reply_bank_fts f
    JOIN reply_bank b ON b.rowid = f.rowid
    WHERE reply_bank_fts MATCH ?
      AND fail_count < 3
    LIMIT 40
  `).all(query) as BankRow[];

  for (const row of bankRows) {
    const similarity = jaccardSimilarity(input.userMessage, row.reply_text) * 0.4;
    const score = scoreCandidate(similarity, row);
    const current = byKey.get(row.reply_text);
    if (!current || toDirectScore(score) > current.score) {
      byKey.set(row.reply_text, {
        replyText: row.reply_text,
        source: row.source,
        category: row.category ?? undefined,
        weight: row.weight,
        approved: row.approved === 1,
        score: toDirectScore(score),
      });
    }
  }

  const popularRows = db.prepare(`
    SELECT reply_text, source, category, weight, success_count, fail_count, approved
    FROM reply_bank
    WHERE fail_count < 3 AND LENGTH(clean_reply_text) <= 80
    ORDER BY approved DESC, success_count DESC, usage_count DESC, weight DESC, RANDOM()
    LIMIT 8
  `).all() as BankRow[];

  for (const row of popularRows) {
    if (byKey.has(row.reply_text)) continue;
    const score = scoreCandidate(0.05, row);
    byKey.set(row.reply_text, {
      replyText: row.reply_text,
      source: row.source,
      category: row.category ?? undefined,
      weight: row.weight,
      approved: row.approved === 1,
      score: toDirectScore(score),
    });
  }

  const candidates = [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);

  if (candidates.length > 0) {
    const texts = candidates.map((candidate) => candidate.replyText);
    const placeholders = texts.map(() => "?").join(",");
    db.prepare(`UPDATE reply_bank SET usage_count = usage_count + 1 WHERE reply_text IN (${placeholders})`).run(...texts);
  }

  return candidates;
}
