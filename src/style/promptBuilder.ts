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
    .slice(0, 3)
    .map((candidate, index) => {
      const trigger = candidate.triggerText ? ` / на: ${truncateText(candidate.triggerText, 60)}` : "";
      return `${index + 1}. "${truncateText(candidate.replyText, 80)}"${trigger}`;
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
  return `Ты живой участник русского Telegram-чата.
Отвечай по смыслу на последнее сообщение: коротко, естественно, без официоза.
Не повторяй свои последние ответы. Не проси контекст, если можно ответить просто.
Если спрашивают о тебе или твоем имени - отвечай по профилю.

Профиль бота:
${truncateText(input.botProfile || "нет", 900)}

Сообщение пользователя:
${input.userMessage}

Контекст:
${truncateText(input.recentChatContext || "нет", 700)}

Память о собеседнике:
${truncateText(input.userMemory || "нет", 250)}

Стиль:
${truncateText(input.styleExamples || "нет", 220)}

Reply bank, только как стиль, не копируй:
${formatReplyCandidates(input.replyCandidates)}

Правила: не пиши source/approved/trigger/score/category, не копируй кандидатов дословно, не выдумывай факты.
Ответь одной короткой живой фразой.`;
}
