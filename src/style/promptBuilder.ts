import type { ReplyCandidate } from "./replyBankRetriever.js";

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function formatReplyCandidates(candidates: ReplyCandidate[]): string {
  const usefulCandidates = candidates.filter((candidate) => {
    const text = candidate.replyText.trim().toLowerCase();
    return text.length > 4 && !["хз", "ну хз", "ну такое", "надо подумать", "всм?", "че именно?"].includes(text);
  });
  if (usefulCandidates.length === 0) return "нет";
  return usefulCandidates
    .slice(0, 5)
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
Не повторяй свои последние ответы из контекста.

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

Используй их только как подсказку по тону и лексике.
Не копируй кандидатов дословно. Ответ должен быть новым и подходить к последнему сообщению.
Можно слегка взять настроение или 1-2 слова, но смысл ответа формируй сам.

Нельзя:
- копировать длинные личные сообщения;
- копировать короткие заготовки вроде "хз", "ну такое", "надо подумать";
- использовать ответ, если он не подходит по контексту;
- писать слишком длинно.
- писать служебные поля вроде source, approved, trigger, score, category.
- выдумывать факты о человеке, если их нет в памяти или контексте.

Сгенерируй короткий ответ в этом стиле.
Ответь одной живой фразой по смыслу последнего сообщения.`;
}
