import { config } from "../config.js";
import { addChatContext, getRecentBotReplies, getRecentChatContext, getUserMemory } from "../style/replyBank.js";
import { retrieveReplyCandidates } from "../style/replyBankRetriever.js";
import { buildPrompt } from "../style/promptBuilder.js";
import { getStyleExamples } from "../style/styleExamples.js";
import { getFallbackReply, getFastCommonReply } from "../style/fallbackReplies.js";
import { cleanText, looksLikeGibberish } from "../style/text.js";
import { logger } from "../logger.js";

let ollamaQueue: Promise<void> = Promise.resolve();

async function enqueueOllama<T>(task: () => Promise<T>): Promise<T> {
  const previous = ollamaQueue;
  let release!: () => void;
  ollamaQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function cleanGeneratedReply(text: string): string {
  const withoutServiceLines = text
    .split(/\r?\n/)
    .filter((line) => !/\b(source|approved|trigger|score|category)\s*:/i.test(line))
    .join(" ");
  return cleanText(withoutServiceLines)
    .replace(/\s*\|\s*(source|approved|trigger|score|category)\b.*$/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function tooSimilar(left: string, right: string): boolean {
  const a = cleanText(left).toLowerCase();
  const b = cleanText(right).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 12 && b.includes(a)) return true;
  return false;
}

function isLowQualityReply(text: string, input: { userMessage: string; recentBotReplies: string[] }): boolean {
  const clean = cleanGeneratedReply(text);
  if (!clean || clean.length > 260) return true;
  if (looksLikeGibberish(clean)) return true;
  if (/\b(source|approved|trigger|score|category|reply bank|кандидаты ответов|сообщение пользователя)\b/i.test(clean)) return true;
  if (/^(as an ai|i'?m sorry|я не могу|как языковая модель)/i.test(clean)) return true;
  const latin = clean.match(/[a-z]/gi)?.length ?? 0;
  const cyrillic = clean.match(/[а-яё]/gi)?.length ?? 0;
  if (latin > 20 && latin > cyrillic) return true;
  if (tooSimilar(clean, input.userMessage) && clean.length > 20) return true;
  return input.recentBotReplies.some((reply) => tooSimilar(clean, reply));
}

function chooseSafeReply(input: {
  generated: string;
  userMessage: string;
  recentBotReplies: string[];
  candidates: Array<{ replyText: string }>;
}): string {
  const generated = cleanGeneratedReply(input.generated);
  if (!isLowQualityReply(generated, { userMessage: input.userMessage, recentBotReplies: input.recentBotReplies })) {
    return generated;
  }
  const candidate = input.candidates.find((item) => !input.recentBotReplies.some((reply) => tooSimilar(item.replyText, reply)))?.replyText;
  return candidate ?? getFastCommonReply(input.userMessage) ?? getFallbackReply(input.userMessage);
}

async function callOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      stream: false,
      keep_alive: "10m",
      options: {
        temperature: 0.75,
        num_ctx: 1024,
        num_predict: 28,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { response?: string };
  return (data.response ?? "").trim();
}

export async function generateReply(input: {
  userMessage: string;
  chatId: string;
  userId?: string;
  userMessageId?: string;
}): Promise<{ text: string; usedDirectReply: boolean }> {
  if (looksLikeGibberish(input.userMessage)) {
    const text = getFallbackReply(input.userMessage);
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text, role: "bot" });
    return { text, usedDirectReply: true };
  }

  const replyCandidates = await retrieveReplyCandidates({
    userMessage: input.userMessage,
    chatId: input.chatId,
    limit: config.replyCandidateLimit,
  });
  const recentBotReplies = getRecentBotReplies(input.chatId, 8);

  const direct = replyCandidates.find((candidate) =>
    candidate.approved
    && candidate.score >= config.directReplyMinScore
    && !recentBotReplies.some((reply) => tooSimilar(candidate.replyText, reply)),
  );
  if (config.directReplyEnabled && direct) {
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text: direct.replyText, role: "bot" });
    return { text: direct.replyText, usedDirectReply: true };
  }

  const fastCommonReply = config.fastCommonRepliesEnabled ? getFastCommonReply(input.userMessage) : null;
  if (fastCommonReply) {
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text: fastCommonReply, role: "bot" });
    return { text: fastCommonReply, usedDirectReply: true };
  }

  if (!config.llmEnabled) {
    const text = replyCandidates[0]?.replyText ?? getFallbackReply(input.userMessage);
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text, role: "bot" });
    return { text, usedDirectReply: true };
  }

  const prompt = buildPrompt({
    userMessage: input.userMessage,
    recentChatContext: getRecentChatContext(input.chatId, 12),
    userMemory: getUserMemory({ chatId: input.chatId, userId: input.userId }),
    styleExamples: getStyleExamples(6),
    replyCandidates,
  });

  let generated = "";
  try {
    generated = await enqueueOllama(() => callOllama(prompt));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn(`[ollama] timed out after ${config.ollamaTimeoutMs}ms`);
    } else {
      logger.error(error);
    }
    generated = replyCandidates[0]?.replyText ?? getFastCommonReply(input.userMessage) ?? getFallbackReply(input.userMessage);
  }
  const text = chooseSafeReply({
    generated,
    userMessage: input.userMessage,
    recentBotReplies,
    candidates: replyCandidates,
  }) || "не понял, давай подробнее";
  addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
  addChatContext({ chatId: input.chatId, text, role: "bot" });
  return { text, usedDirectReply: false };
}
