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
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s?!]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const synonymGroups = [
  ["думаешь", "считаешь", "мнение", "идея", "оцени", "как тебе", "что скажешь"],
  ["знаешь", "знаком", "слышал", "шаришь", "в курсе"],
  ["понял", "понятно", "понимаешь", "ясно"],
  ["привет", "ку", "дарова", "здарова", "хай"],
  ["смешно", "ахах", "ыы", "поржал", "рофл"],
  ["плохо", "мутно", "странно", "кринж", "сомнительно"],
  ["хорошо", "норм", "нормально", "ок", "кайф"],
  ["деньги", "курс", "евро", "доллар", "крипта", "биток"],
  ["сервер", "впс", "vps", "деплой", "хостинг"],
];

const synonymMap = new Map<string, string>();
for (const group of synonymGroups) {
  const canonical = group[0];
  for (const word of group) synonymMap.set(word, canonical);
}

function stemToken(token: string): string {
  if (token.length <= 4) return token;
  return token
    .replace(/(ами|ями|ого|ему|ыми|ими|ах|ях|ов|ев|ом|ем|ой|ый|ий|ая|ое|ые|ую|юю|а|я|ы|и|е|у|ю|о)$/i, "")
    .slice(0, 18);
}

export function semanticTokens(text: string): string[] {
  const normalized = normalizeText(text);
  const rawTokens = normalized.split(/\s+/).filter((token) => token.length > 1);
  const tokens: string[] = [];
  for (const token of rawTokens) {
    tokens.push(synonymMap.get(token) ?? stemToken(token));
  }
  for (const [phrase, canonical] of synonymMap.entries()) {
    if (phrase.includes(" ") && normalized.includes(phrase)) tokens.push(canonical);
  }
  return [...new Set(tokens)];
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
  return new Set(semanticTokens(text));
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

function charNgrams(text: string): Set<string> {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 2; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

export function charSimilarity(left: string, right: string): number {
  const a = charNgrams(left);
  const b = charNgrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  return intersection / Math.max(a.size, b.size);
}

export function textSimilarity(left: string, right: string): number {
  const token = jaccardSimilarity(left, right);
  const chars = charSimilarity(left, right);
  const leftNorm = normalizeText(left);
  const rightNorm = normalizeText(right);
  const phraseBoost = leftNorm.length > 4 && rightNorm.includes(leftNorm) ? 0.25 : 0;
  return Math.min(1, token * 0.7 + chars * 0.3 + phraseBoost);
}

export function ftsQuery(text: string): string {
  const terms = normalizeText(text)
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, '""')}"`);
  return terms.length > 0 ? terms.join(" OR ") : '""';
}
