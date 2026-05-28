import { db } from "../db/index.js";
import { classifyReply, ftsQuery, normalizeText, textSimilarity } from "./text.js";

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
  usage_count: number;
};

type BankRow = {
  reply_text: string;
  source: string;
  category: string | null;
  weight: number;
  success_count: number;
  fail_count: number;
  approved: number;
  usage_count: number;
};

function scoreCandidate(
  similarity: number,
  row: { weight: number; success_count: number; fail_count: number; approved: number; usage_count?: number; category?: string | null },
  inputCategory?: string,
): number {
  const approvedBonus = row.approved ? 0.7 : 0;
  const categoryBonus = inputCategory && row.category === inputCategory ? 0.25 : 0;
  const overusePenalty = Math.min(row.usage_count ?? 0, 25) * 0.015;
  return similarity * 1.4 + row.weight + row.success_count * 0.3 - row.fail_count * 0.7 + approvedBonus + categoryBonus - overusePenalty;
}

function toDirectScore(score: number): number {
  return Math.max(0, Math.min(0.99, score / 3.4));
}

function addCandidate(map: Map<string, ReplyCandidate>, candidate: ReplyCandidate): void {
  const key = normalizeText(candidate.replyText);
  const current = map.get(key);
  if (!current || candidate.score > current.score) {
    map.set(key, candidate);
  }
}

function diversify(candidates: ReplyCandidate[], limit: number): ReplyCandidate[] {
  const selected: ReplyCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const duplicate = selected.some((item) => textSimilarity(item.replyText, candidate.replyText) > 0.82);
    if (!duplicate) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export async function retrieveReplyCandidates(input: {
  userMessage: string;
  chatId: string;
  limit: number;
}): Promise<ReplyCandidate[]> {
  const query = ftsQuery(input.userMessage);
  const inputCategory = classifyReply(input.userMessage).category;
  const byKey = new Map<string, ReplyCandidate>();

  const pairRows = db.prepare(`
    SELECT
      p.reply_text, p.trigger_text, p.source,
      b.category,
      p.weight + b.weight AS weight,
      p.success_count + b.success_count AS success_count,
      p.fail_count + b.fail_count AS fail_count,
      p.usage_count + b.usage_count AS usage_count,
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
    const similarity = textSimilarity(input.userMessage, row.trigger_text);
    const score = scoreCandidate(similarity, row, inputCategory);
    addCandidate(byKey, {
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
    SELECT reply_text, source, category, weight, success_count, fail_count, approved, usage_count
    FROM reply_bank_fts f
    JOIN reply_bank b ON b.rowid = f.rowid
    WHERE reply_bank_fts MATCH ?
      AND fail_count < 3
    LIMIT 40
  `).all(query) as BankRow[];

  for (const row of bankRows) {
    const similarity = textSimilarity(input.userMessage, row.reply_text) * 0.45;
    const score = scoreCandidate(similarity, row, inputCategory);
    addCandidate(byKey, {
      replyText: row.reply_text,
      source: row.source,
      category: row.category ?? undefined,
      weight: row.weight,
      approved: row.approved === 1,
      score: toDirectScore(score),
    });
  }

  const popularRows = db.prepare(`
    SELECT reply_text, source, category, weight, success_count, fail_count, approved, usage_count
    FROM reply_bank
    WHERE fail_count < 3 AND LENGTH(clean_reply_text) <= 80
    ORDER BY approved DESC, success_count DESC, usage_count DESC, weight DESC, RANDOM()
    LIMIT 8
  `).all() as BankRow[];

  for (const row of popularRows) {
    const score = scoreCandidate(row.category === inputCategory ? 0.12 : 0.04, row, inputCategory);
    addCandidate(byKey, {
      replyText: row.reply_text,
      source: row.source,
      category: row.category ?? undefined,
      weight: row.weight,
      approved: row.approved === 1,
      score: toDirectScore(score),
    });
  }

  const candidates = diversify([...byKey.values()], input.limit);

  if (candidates.length > 0) {
    const texts = candidates.map((candidate) => candidate.replyText);
    const placeholders = texts.map(() => "?").join(",");
    db.prepare(`UPDATE reply_bank SET usage_count = usage_count + 1 WHERE reply_text IN (${placeholders})`).run(...texts);
  }

  return candidates;
}
