import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { cleanText } from "./text.js";

const profilePath = join(dirname(config.databasePath), "bot_profile.md");

const defaultProfile = `Тебя зовут Темыч.
Ты общаешься как живой участник Telegram-чата.
Ты не говоришь, что ты бот или ИИ, если тебя прямо не спрашивают.

Факты о тебе:
- Ты тусуешься в этом чате.
- Ты помнишь, что тебя иногда зовут Темыч.
- Тебя перенесли на VPS, чтобы ты был постоянно онлайн.
- Ты учишься через reply bank, approve/reject и новые фразы из чата.

Стиль:
- отвечай коротко;
- без официоза;
- можно слегка иронично;
- не используй канцелярит;
- не объясняй лишнего.`;

function ensureProfile(): void {
  mkdirSync(dirname(profilePath), { recursive: true });
  if (!existsSync(profilePath)) {
    writeFileSync(profilePath, `${defaultProfile}\n`, "utf8");
  }
}

export function getBotProfile(): string {
  ensureProfile();
  return readFileSync(profilePath, "utf8").trim();
}

export function getBotDisplayName(): string {
  const profile = getBotProfile();
  const match = profile.match(/(?:тебя зовут|зовут тебя|имя[:\s]+)\s*([А-ЯЁA-Z][а-яёa-zA-Z-]{1,30})/i);
  return match?.[1] ?? "Темыч";
}

function profileLines(): string[] {
  return getBotProfile()
    .split(/\r?\n/)
    .map((line) => cleanText(line.replace(/^[-*]\s*/, "")))
    .filter(Boolean);
}

export function getBotProfileFallbackAnswer(userMessage: string): string | null {
  const message = cleanText(userMessage).toLowerCase().replace(/ё/g, "е");

  if (/(как тебя зовут|как звать|твое имя|твоё имя|ты кто)/i.test(message)) {
    return `я ${getBotDisplayName()}`;
  }

  if (/детств/i.test(message)) {
    const childhood = profileLines().filter((line) => /детств|маленьк|школ|двор|песк|бесхлебн/i.test(line));
    if (childhood.length > 0) {
      return childhood.slice(0, 2).join(". ").replace(/\.+$/, "");
    }
  }

  if (/(что.*с тобой|событ|прошл|биограф|помнишь)/i.test(message)) {
    const facts = profileLines().filter((line) => !/^стиль:?$/i.test(line) && !/^факты о тебе:?$/i.test(line));
    if (facts.length > 0) return facts.slice(0, 2).join(". ").replace(/\.+$/, "");
  }

  return null;
}

export function resetBotProfile(): void {
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `${defaultProfile}\n`, "utf8");
}

export function addBotProfileFact(fact: string): boolean {
  const clean = cleanText(fact);
  if (!clean || clean.length > 300) return false;
  const current = getBotProfile();
  const factLine = `- ${clean}`;
  if (current.includes("Стиль:")) {
    writeFileSync(profilePath, `${current.replace(/\nСтиль:/, `\n${factLine}\n\nСтиль:`)}\n`, "utf8");
    return true;
  }
  if (current.includes("Факты о тебе:")) {
    writeFileSync(profilePath, `${current}\n${factLine}\n`, "utf8");
    return true;
  }
  writeFileSync(profilePath, `${current}\n\nФакты о тебе:\n${factLine}\n`, "utf8");
  return true;
}

export function setBotProfileStyle(style: string): boolean {
  const clean = cleanText(style);
  if (!clean || clean.length > 600) return false;
  const current = getBotProfile();
  writeFileSync(profilePath, `${current}\n\nДополнительный стиль:\n${clean}\n`, "utf8");
  return true;
}
