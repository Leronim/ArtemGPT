import { createHash } from "node:crypto";

const linkOnly = /^https?:\/\/\S+$/i;
const hasPrivateData = /(\+?\d[\d\s().-]{8,}\d)|([^\s@]+@[^\s@]+\.[^\s@]+)|\b(passport|iban|swift|address|адрес|паспорт|карта)\b/i;

export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
}

export function stripMentions(text: string): string {
  return cleanText(text.replace(/(^|\s)@[a-zA-Z0-9_]{3,32}\b/g, " "));
}

export function cleanLearnedText(text: string): string {
  return stripMentions(text);
}

export function normalizeText(text: string): string {
  return cleanLearnedText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?!]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

export function canUseAsReply(text: string): boolean {
  const clean = cleanLearnedText(text);
  if (!clean || clean.startsWith("/")) return false;
  if (clean.length < 2 || clean.length > 420) return false;
  if (linkOnly.test(clean)) return false;
  if (hasPrivateData.test(clean)) return false;
  if (!/[a-zа-яё0-9]/i.test(clean)) return false;
  const words = normalizeText(clean).split(/\s+/).filter(Boolean);
  if (words.length > 55) return false;
  return true;
}

export function containsPrivateData(text: string): boolean {
  return hasPrivateData.test(text);
}

export function canUseAsPairTrigger(text: string): boolean {
  const clean = cleanLearnedText(text);
  if (!clean || clean.length > 600 || hasPrivateData.test(clean)) return false;
  return !linkOnly.test(clean);
}

export function looksLikeGibberish(text: string): boolean {
  const normalized = normalizeText(text).replace(/\s+/g, "");
  if (normalized.length < 10) return false;

  const latin = normalized.match(/[a-z]/g)?.length ?? 0;
  const cyrillic = normalized.match(/[а-яё]/g)?.length ?? 0;
  const letters = latin + cyrillic;
  if (letters < 10) return false;

  const vowels = normalized.match(/[aeiouyаеёиоуыэюя]/g)?.length ?? 0;
  const vowelRatio = vowels / letters;
  const longConsonantRun = /[bcdfghjklmnpqrstvwxzбвгджзйклмнпрстфхцчшщ]{7,}/i.test(normalized);
  const hasKnownShape = /\b(как|что|че|чё|кто|где|зачем|почему|знаешь|думаешь|надо|можно|привет|ку|hello|what|why|how)\b/i.test(normalizeText(text));

  return !hasKnownShape && (longConsonantRun || vowelRatio < 0.18 || vowelRatio > 0.72);
}

export function classifyReply(text: string): { category: string; intent: string } {
  const normalized = normalizeText(text);
  if (/(всм|что|че|чё|не понял|подробнее|поясни)/i.test(normalized)) {
    return { category: "confusion", intent: normalized.includes("подробнее") ? "ask_details" : "not_understood" };
  }
  if (/(да норм|ну так да|соглас|верно|ага|угу|так да)/i.test(normalized)) {
    return { category: "agreement", intent: "agree" };
  }
  if (/(та не|не совсем|неа|хз|мутно|сомн)/i.test(normalized)) {
    return { category: "disagreement", intent: "disagree" };
  }
  if (/(ыы|ахах|лол|поржал|смешн|рофл)/i.test(normalized)) {
    return { category: "laugh", intent: "joke" };
  }
  if (/(не загоняйся|ниче|ничего|держись|норм будет)/i.test(normalized)) {
    return { category: "support", intent: "support" };
  }
  if (/(забей|проехали|пох|ладно)/i.test(normalized)) {
    return { category: "generic", intent: "dismiss" };
  }
  if (/(курс|доллар|евро|биток|акци|инвест|деньг)/i.test(normalized)) {
    return { category: "money", intent: "explain" };
  }
  if (/(аниме|манг|серия|тян)/i.test(normalized)) {
    return { category: "anime", intent: "explain" };
  }
  if (/(машин|тачк|мотор|двиг|бмв|мерс)/i.test(normalized)) {
    return { category: "cars", intent: "explain" };
  }
  if (/(код|сервер|баг|деплой|api|ошибк)/i.test(normalized)) {
    return { category: "technical", intent: "explain" };
  }
  return { category: "generic", intent: "explain" };
}

export function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(/\s+/).filter((word) => word.length > 1));
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function ftsQuery(text: string): string {
  const terms = normalizeText(text)
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, '""')}"`);
  return terms.length > 0 ? terms.join(" OR ") : '""';
}
