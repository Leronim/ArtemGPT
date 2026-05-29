import { looksLikeGibberish, normalizeText } from "./text.js";
import { getBotDisplayName } from "./botProfile.js";

const variants = {
  greeting: ["ку", "дарова", "привет"],
  howAreYou: ["да норм, живой", "норм, ты как?", "та нормально вроде"],
  whatDoYouThink: ["ну хз, звучит мутно", "надо чуть подробнее, а то пока не понял", "в целом норм, но есть нюансы"],
  confused: ["всм?", "ниче не понял, давай подробнее", "че именно?"],
  generic: ["не понял, скажи конкретнее", "дай чуть контекста", "а про что именно?"],
  gibberish: ["ниче не понял", "всм?", "это че щас было"],
};

function pick(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)] ?? items[0] ?? "та хз";
}

export function getFastCommonReply(userMessage: string): string | null {
  const text = normalizeText(userMessage);
  if (!text) return null;

  if (looksLikeGibberish(userMessage)) {
    return pick(variants.gibberish);
  }

  if (/(как тебя зовут|как звать|твое имя|твоё имя|ты кто|как тебя зовут\??)/i.test(text)) {
    return `я ${getBotDisplayName()}`;
  }

  if (/^(ку|привет|здарова|дарова|хай|hello|hi)\b/i.test(text)) {
    return pick(variants.greeting);
  }

  if (/(как дела|как ты|че как|чё как|как жизнь|темыч.*как)/i.test(text)) {
    return pick(variants.howAreYou);
  }

  if (/(что думаешь|че думаешь|чё думаешь|как тебе|норм идея|стоит ли)/i.test(text)) {
    return pick(variants.whatDoYouThink);
  }

  if (/^(всм|что|че|чё|\?)\??$/i.test(text) || /(не понял|поясни)/i.test(text)) {
    return pick(variants.confused);
  }

  if (text.length <= 18 && /[?!]$/.test(text)) {
    return pick(variants.generic);
  }

  return null;
}

export function getFallbackReply(userMessage: string): string {
  if (looksLikeGibberish(userMessage)) {
    return pick(variants.gibberish);
  }
  return pick(variants.generic);
}
