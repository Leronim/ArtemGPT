import { db } from "../db/index.js";

export function getStyleExamples(limit = 12): string {
  const rows = db.prepare(`
    SELECT reply_text FROM reply_bank
    WHERE fail_count < 3
    ORDER BY approved DESC, success_count DESC, RANDOM()
    LIMIT ?
  `).all(limit) as Array<{ reply_text: string }>;
  return rows.map((row) => `- ${row.reply_text}`).join("\n");
}
