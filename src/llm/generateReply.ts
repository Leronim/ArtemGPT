import { config } from "../config.js";
import { addChatContext, getRecentBotReplies, getRecentChatContext, getUserMemory, getUserMemoryFallbackAnswer } from "../style/replyBank.js";
import { retrieveReplyCandidates } from "../style/replyBankRetriever.js";
import { buildPrompt } from "../style/promptBuilder.js";
import { getFallbackReply } from "../style/fallbackReplies.js";
import { cleanText, looksLikeGibberish } from "../style/text.js";
import { logger } from "../logger.js";
import { getBotProfile, getBotProfileFallbackAnswer } from "../style/botProfile.js";

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
  if (a.length > 12 && b.length > 12 && (a.includes(b) || b.includes(a))) return true;
  if (a.length <= 12 && b.includes(a)) return true;
  return false;
}

function isLowQualityReply(text: string, input: { userMessage: string; recentBotReplies: string[] }): boolean {
  const clean = cleanGeneratedReply(text);
  if (!clean || clean.length > 260) return true;
  if (/^(хз|ну хз|ну такое|надо подумать|не знаю)$/i.test(clean)) return true;
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
  profileFallback?: string | null;
}): string {
  const generated = cleanGeneratedReply(input.generated);
  if (!isLowQualityReply(generated, { userMessage: input.userMessage, recentBotReplies: input.recentBotReplies })) {
    return generated;
  }
  if (input.profileFallback) return input.profileFallback;
  return getFallbackReply(input.userMessage);
}

function isBotSelfQuestion(text: string): boolean {
  const clean = cleanText(text).toLowerCase().replace(/ё/g, "е");
  return /(ты|тебя|тебе|тобой|твой|твое|своего|своем|себе).{0,30}(зовут|имя|кто|детств|прошл|истори|биограф|событ|профил|помнишь)/i.test(clean)
    || /(как тебя зовут|ты кто|расскажи.*детств|что.*детств|что.*с тобой)/i.test(clean);
}

function chooseLearnedReplyHint(input: {
  candidates: Array<{ replyText: string; approved?: boolean; score: number }>;
  userMessage: string;
  recentBotReplies: string[];
}): string | undefined {
  return input.candidates.find((candidate) =>
    candidate.approved
    && candidate.score >= 0.72
    && !tooSimilar(candidate.replyText, input.userMessage)
    && !input.recentBotReplies.some((reply) => tooSimilar(candidate.replyText, reply)),
  )?.replyText;
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
        temperature: 0.9,
        top_p: 0.92,
        repeat_penalty: 1.18,
        num_ctx: 1024,
        num_predict: 45,
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
  const selfQuestion = isBotSelfQuestion(input.userMessage);
  const profileFallback = selfQuestion ? getBotProfileFallbackAnswer(input.userMessage) : null;
  const userMemoryFallback = getUserMemoryFallbackAnswer(input);

  if (userMemoryFallback) {
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text: userMemoryFallback, role: "bot" });
    return { text: userMemoryFallback, usedDirectReply: true };
  }

  if (looksLikeGibberish(input.userMessage)) {
    const text = getFallbackReply(input.userMessage);
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text, role: "bot" });
    return { text, usedDirectReply: true };
  }

  const replyCandidates = await retrieveReplyCandidates({
    userMessage: input.userMessage,
    chatId: input.chatId,
    limit: Math.min(config.replyCandidateLimit, 3),
  });
  const recentBotReplies = getRecentBotReplies(input.chatId, 5);

  if (!config.llmEnabled) {
    const candidate = replyCandidates.find((item) => !tooSimilar(item.replyText, input.userMessage))?.replyText;
    const text = profileFallback ?? candidate ?? getFallbackReply(input.userMessage);
    addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
    addChatContext({ chatId: input.chatId, text, role: "bot" });
    return { text, usedDirectReply: true };
  }

  const prompt = buildPrompt({
    userMessage: input.userMessage,
    botProfile: getBotProfile(),
    recentChatContext: getRecentChatContext(input.chatId, 4),
    userMemory: getUserMemory({ chatId: input.chatId, userId: input.userId }),
    learnedReply: selfQuestion ? undefined : chooseLearnedReplyHint({
      candidates: replyCandidates,
      userMessage: input.userMessage,
      recentBotReplies,
    }),
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
    generated = "";
  }
  const text = chooseSafeReply({
    generated,
    userMessage: input.userMessage,
    recentBotReplies,
    profileFallback,
  }) || "не понял, давай подробнее";
  addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
  addChatContext({ chatId: input.chatId, text, role: "bot" });
  return { text, usedDirectReply: false };
}
