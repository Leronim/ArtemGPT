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

export function resetBotProfile(): void {
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `${defaultProfile}\n`, "utf8");
}

export function addBotProfileFact(fact: string): boolean {
  const clean = cleanText(fact);
  if (!clean || clean.length > 300) return false;
  const current = getBotProfile();
  writeFileSync(profilePath, `${current}\n- ${clean}\n`, "utf8");
  return true;
}

export function setBotProfileStyle(style: string): boolean {
  const clean = cleanText(style);
  if (!clean || clean.length > 600) return false;
  const current = getBotProfile();
  writeFileSync(profilePath, `${current}\n\nДополнительный стиль:\n${clean}\n`, "utf8");
  return true;
}
