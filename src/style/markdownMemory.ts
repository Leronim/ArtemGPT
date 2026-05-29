import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { cleanText } from "./text.js";

const memoryPath = join(dirname(config.databasePath), "bot_memory.md");
const maxChunkLength = 900;

const stopWords = new Set([
  "а", "без", "бы", "в", "во", "вот", "да", "для", "до", "его", "ее", "её", "же", "за", "и", "из",
  "или", "как", "ко", "ли", "мне", "на", "над", "не", "но", "ну", "о", "об", "он", "она", "они",
  "от", "по", "под", "про", "с", "со", "так", "там", "те", "тебя", "тебе", "то", "ты", "у", "что",
  "это", "я",
]);

type MarkdownChunk = {
  title: string;
  text: string;
  tokens: Set<string>;
};

function ensureMemoryFile(): void {
  mkdirSync(dirname(memoryPath), { recursive: true });
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, "# Память\n\nДобавляй сюда факты, истории и события, которые бот должен помнить.\n", "utf8");
  }
}

function tokenize(text: string): Set<string> {
  const normalized = cleanText(text).toLowerCase().replace(/ё/g, "е");
  const words = normalized.match(/[а-яa-z0-9-]{3,}/gi) ?? [];
  return new Set(words.filter((word) => !stopWords.has(word)));
}

function pushChunk(chunks: MarkdownChunk[], title: string, text: string): void {
  const clean = text.trim();
  if (!clean) return;
  chunks.push({
    title: title || "Память",
    text: clean.length > maxChunkLength ? `${clean.slice(0, maxChunkLength).trim()}...` : clean,
    tokens: tokenize(`${title} ${clean}`),
  });
}

function splitLongBlock(block: string): string[] {
  const paragraphs = block.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChunkLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = paragraph.length > maxChunkLength ? paragraph.slice(0, maxChunkLength) : paragraph;
  }

  if (current) chunks.push(current);
  return chunks;
}

function readMarkdownChunks(): MarkdownChunk[] {
  ensureMemoryFile();
  const markdown = readFileSync(memoryPath, "utf8");
  const lines = markdown.split(/\r?\n/);
  const chunks: MarkdownChunk[] = [];
  let currentTitle = "Память";
  let buffer: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      for (const part of splitLongBlock(buffer.join("\n"))) {
        pushChunk(chunks, currentTitle, part);
      }
      currentTitle = cleanText(heading[2]);
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  for (const part of splitLongBlock(buffer.join("\n"))) {
    pushChunk(chunks, currentTitle, part);
  }

  return chunks;
}

function scoreChunk(chunk: MarkdownChunk, queryTokens: Set<string>): number {
  let score = 0;
  const titleTokens = tokenize(chunk.title);
  for (const token of queryTokens) {
    if (chunk.tokens.has(token)) score += 1;
    if (titleTokens.has(token)) score += 1.5;
  }
  return score;
}

function isBroadMemoryQuestion(text: string): boolean {
  const clean = cleanText(text).toLowerCase().replace(/ё/g, "е");
  return /(что|че|чё|расскажи|покажи|напомни).{0,40}(добавил|добавили|запомнил|памят|memory|md|мд)/i.test(clean)
    || /(что|че|чё).{0,20}(у тебя|там).{0,20}(в памяти|в memory|в md|в мд)/i.test(clean);
}

function formatChunks(chunks: MarkdownChunk[]): string {
  return chunks.map((chunk) => `## ${chunk.title}\n${chunk.text}`).join("\n\n");
}

export function getRelevantMarkdownContext(input: { userMessage: string; limit?: number }): string {
  const limit = input.limit ?? 4;
  const allChunks = readMarkdownChunks();

  if (isBroadMemoryQuestion(input.userMessage)) {
    return formatChunks(allChunks.slice(0, limit));
  }

  const queryTokens = tokenize(input.userMessage);
  if (queryTokens.size === 0) return "";

  const chunks = allChunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);

  return formatChunks(chunks);
}
