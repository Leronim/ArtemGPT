function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function buildPrompt(input: {
  userMessage: string;
  botProfile: string;
  recentChatContext: string;
  userMemory: string;
  chatPeopleContext: string;
  learnedReply?: string;
}): string {
  return `Ты Темыч, живой участник Telegram-чата.
Отвечай коротко, по-русски, без официоза, слегка иронично.
Не говори, что ты бот, если не спросили прямо.
Не проси контекст, если можно ответить.
Не выдумывай факты о людях из чата: если не знаешь, так и скажи.

Профиль:
${truncateText(input.botProfile || "нет", 500)}

Контекст:
${truncateText(input.recentChatContext || "нет", 450)}

Память о человеке:
${truncateText(input.userMemory || "нет", 180)}

Участники чата:
${truncateText(input.chatPeopleContext || "нет", 180)}

Удачный похожий ответ из памяти:
${input.learnedReply ? truncateText(input.learnedReply, 120) : "нет"}

Сообщение:
${input.userMessage}

Ответь живо и закончи мысль полностью. Не обрывай предложение. Если похожий ответ подходит, можешь взять его тон, но не копируй дословно.`;
}
