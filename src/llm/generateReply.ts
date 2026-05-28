import { config } from "../config.js";
import { addChatContext, getRecentChatContext } from "../style/replyBank.js";
import { retrieveReplyCandidates } from "../style/replyBankRetriever.js";
import { buildPrompt } from "../style/promptBuilder.js";
import { getStyleExamples } from "../style/styleExamples.js";
import { getFallbackReply, getFastCommonReply } from "../style/fallbackReplies.js";
import { cleanText, looksLikeGibberish } from "../style/text.js";

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

  const direct = replyCandidates.find((candidate) => candidate.approved && candidate.score >= config.directReplyMinScore);
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
    styleExamples: getStyleExamples(6),
    replyCandidates,
  });

  let generated = "";
  try {
    generated = await callOllama(prompt);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[ollama] timed out after ${config.ollamaTimeoutMs}ms`);
    } else {
      console.error(error);
    }
    generated = replyCandidates[0]?.replyText ?? getFastCommonReply(input.userMessage) ?? getFallbackReply(input.userMessage);
  }
  const text = cleanGeneratedReply(generated) || "не понял, давай подробнее";
  addChatContext({ chatId: input.chatId, userId: input.userId, messageId: input.userMessageId, text: input.userMessage, role: "user" });
  addChatContext({ chatId: input.chatId, text, role: "bot" });
  return { text, usedDirectReply: false };
}
