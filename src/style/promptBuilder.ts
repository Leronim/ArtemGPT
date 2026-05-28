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
  recentChatContext: string;
  styleExamples: string;
  replyCandidates: ReplyCandidate[];
}): string {
  return `Ты отвечаешь как живой человек в русском Telegram-чате.
Твоя задача - ответить по смыслу на последнее сообщение, коротко и естественно.
Не игнорируй вопрос. Если спросили "как дела" - отвечай про свои дела, а не просто приветствуй.
Не пиши длинные объяснения без необходимости.

Сообщение пользователя:
${input.userMessage}

Недавний контекст чата:
${truncateText(input.recentChatContext || "нет", 1800)}

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

Сгенерируй короткий ответ в этом стиле.
Если один из кандидатов идеально подходит, можешь использовать его почти напрямую.`;
}
