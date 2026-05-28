import "dotenv/config";

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  adminUserIds: parseList(process.env.ADMIN_USER_IDS),
  styleSourceUserIds: parseList(process.env.STYLE_SOURCE_USER_IDS),
  databasePath: process.env.DATABASE_PATH ?? "./data/artemgpt.sqlite",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1",
  ollamaTimeoutMs: parseNumber(process.env.OLLAMA_TIMEOUT_MS, 15000),
  llmEnabled: parseBoolean(process.env.LLM_ENABLED, true),
  fastCommonRepliesEnabled: parseBoolean(process.env.FAST_COMMON_REPLIES_ENABLED, true),
  directReplyEnabled: parseBoolean(process.env.DIRECT_REPLY_ENABLED, true),
  directReplyMinScore: parseNumber(process.env.DIRECT_REPLY_MIN_SCORE, 0.9),
  replyLearningEnabled: parseBoolean(process.env.REPLY_LEARNING_ENABLED, true),
  replyCandidateLimit: parseNumber(process.env.REPLY_CANDIDATE_LIMIT, 12),
};

export function isAdmin(userId: string | number | undefined): boolean {
  return userId != null && config.adminUserIds.has(String(userId));
}

export function isStyleSource(userId: string | number | undefined): boolean {
  return userId != null && config.styleSourceUserIds.has(String(userId));
}
