import type { ReplyCandidate } from "./replyBankRetriever.js";

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function formatReplyCandidates(candidates: ReplyCandidate[]): string {
  if (candidates.length === 0) return "нет";
  return candidates
    .slice(0, 6)
    .map((candidate, index) => {
      const trigger = candidate.triggerText ? `\n   на сообщение: ${truncateText(candidate.triggerText, 120)}` : "";
      return `${index + 1}. "${truncateText(candidate.replyText, 140)}"${trigger}`;
    })
    .join("\n");
}

export function buildPrompt(input: {
  userMessage: string;
  botProfile: string;
  recentChatContext: string;
  userMemory: string;
  styleExamples: string;
  replyCandidates: ReplyCandidate[];
}): string {
  return `Ты отвечаешь как живой человек в русском Telegram-чате.
Твоя задача - ответить по смыслу на последнее сообщение, коротко и естественно.
Не игнорируй вопрос. Если спросили "как дела" - отвечай про свои дела, а не просто приветствуй.
Если спрашивают о тебе, твоем имени, событиях с тобой или твоем стиле - отвечай строго по профилю бота.
Не пиши длинные объяснения без необходимости.

Профиль бота:
${truncateText(input.botProfile || "нет", 2500)}

Сообщение пользователя:
${input.userMessage}

Недавний контекст чата:
${truncateText(input.recentChatContext || "нет", 1800)}

Память о собеседнике:
${truncateText(input.userMemory || "нет", 500)}

Похожие фразы из исходного стиля:
${truncateText(input.styleExamples || "нет", 500)}

Кандидаты ответов из reply bank:
${formatReplyCandidates(input.replyCandidates)}

Используй их как варианты того, что бот может ответить.
Можно:
- взять один ответ почти напрямую, если он идеально подходит;
- слегка переформулировать;
- смешать 2-3 короткие реакции.

Нельзя:
- копировать длинные личные сообщения;
- использовать ответ, если он не подходит по контексту;
- писать слишком длинно.
- писать служебные поля вроде source, approved, trigger, score, category.
- выдумывать факты о человеке, если их нет в памяти или контексте.

Сгенерируй короткий ответ в этом стиле.
Если один из кандидатов идеально подходит, можешь использовать его почти напрямую.`;
}
