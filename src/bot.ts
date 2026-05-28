import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config, isAdmin, isStyleSource } from "./config.js";
import {
  addChatContext,
  addReplyPair,
  applyBotResponseReaction,
  approveBotResponse,
  forgetReplyByText,
  getReplyStats,
  learnFromStyleMessage,
  recordBotResponse,
  recordMessage,
  rejectBotResponse,
} from "./style/replyBank.js";
import { generateReply } from "./llm/generateReply.js";
import { cleanText } from "./style/text.js";

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const bot = new Telegraf(config.telegramBotToken);

function replyTarget(ctx: Context): { messageId?: string; text?: string } {
  const messageWithReply = ctx.message && "reply_to_message" in ctx.message ? ctx.message : undefined;
  const reply = messageWithReply?.reply_to_message;
  const text = reply && "text" in reply ? reply.text : undefined;
  return {
    messageId: reply?.message_id == null ? undefined : String(reply.message_id),
    text,
  };
}

function stripBotMention(text: string, botUsername?: string): string {
  if (!botUsername) return text;
  return cleanText(text.replace(new RegExp(`@${botUsername}\\b`, "ig"), ""));
}

function hasBotMention(text: string, botUsername?: string): boolean {
  if (!botUsername) return false;
  return new RegExp(`@${botUsername}\\b`, "i").test(text);
}

function shouldGenerateReply(ctx: Context, rawText: string): boolean {
  if (ctx.chat?.type === "private") return true;
  if (hasBotMention(rawText, ctx.botInfo?.username)) return true;
  if (!config.groupRandomReplyEnabled) return false;
  return Math.random() < Math.max(0, Math.min(1, config.groupRandomReplyChance));
}

const positiveReactionEmojis = new Set(["👍", "❤️", "❤", "🔥", "🥰", "👏", "😁", "😂", "🤣", "👌"]);
const negativeReactionEmojis = new Set(["👎", "💩"]);

function reactionEmoji(reaction: unknown): string | null {
  if (!reaction || typeof reaction !== "object") return null;
  const value = reaction as { type?: string; emoji?: string };
  return value.type === "emoji" && typeof value.emoji === "string" ? value.emoji : null;
}

bot.start(async (ctx) => {
  await ctx.reply("работаю");
});

bot.command("ping", async (ctx) => {
  await ctx.reply("pong");
});

bot.command("whoami", async (ctx) => {
  await ctx.reply([
    `chat_id: ${ctx.chat.id}`,
    `chat_type: ${ctx.chat.type}`,
    `user_id: ${ctx.from?.id ?? "unknown"}`,
    `bot_username: ${ctx.botInfo?.username ?? "unknown"}`,
  ].join("\n"));
});

bot.command("approve", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const target = replyTarget(ctx);
  if (!target.messageId) {
    await ctx.reply("ответь этой командой на сообщение бота");
    return;
  }
  const ok = approveBotResponse(String(ctx.chat.id), target.messageId);
  await ctx.reply(ok ? "запомнил" : "не нашел этот ответ");
});

bot.command("reject", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const target = replyTarget(ctx);
  if (!target.messageId) {
    await ctx.reply("ответь этой командой на сообщение бота");
    return;
  }
  const ok = rejectBotResponse(String(ctx.chat.id), target.messageId);
  await ctx.reply(ok ? "ок, выкинул" : "не нашел этот ответ");
});

bot.command("teach", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const body = cleanText(ctx.message.text.replace(/^\/teach(@\w+)?\s*/i, ""));
  const [trigger, reply] = body.split("=>").map((part) => cleanText(part));
  if (!trigger || !reply) {
    await ctx.reply("формат: /teach trigger => reply");
    return;
  }
  const ok = addReplyPair({
    triggerText: trigger,
    replyText: reply,
    source: "manual",
    sourceChatId: String(ctx.chat.id),
    sourceUserId: String(ctx.from.id),
    approved: true,
  });
  await ctx.reply(ok ? "сохранил" : "не сохранил");
});

bot.command("replies_stats", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const stats = getReplyStats();
  await ctx.reply([
    `reply bank: ${stats.replyBank}`,
    `reply pairs: ${stats.replyPairs}`,
    `approved: ${stats.approved}`,
    `bot learned: ${stats.botLearned}`,
    `manual: ${stats.manual}`,
  ].join("\n"));
});

bot.command("forget_reply", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const target = replyTarget(ctx);
  const text = target.text ?? cleanText(ctx.message.text.replace(/^\/forget_reply(@\w+)?\s*/i, ""));
  if (!text) {
    await ctx.reply("ответь командой на сообщение или передай текст");
    return;
  }
  await ctx.reply(forgetReplyByText(text) ? "забыл" : "не нашел");
});

bot.use(async (ctx, next) => {
  const update = ctx.update as unknown as {
    message_reaction?: {
      chat: { id: number | string };
      message_id: number;
      user?: { id: number | string };
      new_reaction?: unknown[];
    };
    message_reaction_count?: {
      chat: { id: number | string };
      message_id: number;
      reactions?: unknown[];
    };
  };
  const reactionUpdate = update.message_reaction;
  const reactionCountUpdate = update.message_reaction_count;
  if (reactionCountUpdate) {
    console.log(`[reaction_count:update] chat=${reactionCountUpdate.chat.id} msg=${reactionCountUpdate.message_id}`);
    return;
  }

  if (!reactionUpdate) {
    await next();
    return;
  }

  console.log(`[reaction:update] chat=${reactionUpdate.chat.id} msg=${reactionUpdate.message_id} user=${reactionUpdate.user?.id ?? "unknown"}`);

  const emoji = reactionEmoji(reactionUpdate?.new_reaction?.[0]);
  const userId = reactionUpdate?.user?.id;

  if (!reactionUpdate || !emoji || userId == null) return;

  const kind = positiveReactionEmojis.has(emoji)
    ? "positive"
    : negativeReactionEmojis.has(emoji)
      ? "negative"
      : null;
  if (!kind) return;

  const result = applyBotResponseReaction({
    chatId: String(reactionUpdate.chat.id),
    botMessageId: String(reactionUpdate.message_id),
    userId: String(userId),
    emoji,
    kind,
  });

  console.log(`[reaction] chat=${reactionUpdate.chat.id} msg=${reactionUpdate.message_id} user=${userId} emoji=${emoji} result=${result}`);
});

bot.on(message("text"), async (ctx) => {
  const rawText = cleanText(ctx.message.text);
  const text = stripBotMention(rawText, ctx.botInfo?.username);
  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from.id);
  const messageId = String(ctx.message.message_id);
  const replyToMessageId = ctx.message.reply_to_message?.message_id == null ? undefined : String(ctx.message.reply_to_message.message_id);

  console.log(`[text] chat=${chatId} user=${userId} msg=${messageId} text=${JSON.stringify(rawText)}`);

  recordMessage({ chatId, userId, messageId, text: rawText, replyToMessageId });

  if (config.replyLearningEnabled && isStyleSource(userId)) {
    learnFromStyleMessage({ chatId, userId, messageId, text: rawText, replyToMessageId });
  }

  if (rawText.startsWith("/")) return;
  if (!shouldGenerateReply(ctx, rawText)) return;
  if (!text) return;

  try {
    const generated = await generateReply({ userMessage: text, chatId, userId, userMessageId: messageId });
    const sent = await ctx.reply(generated.text, { reply_parameters: { message_id: ctx.message.message_id } });
    recordBotResponse({
      chatId,
      userId,
      userMessageId: messageId,
      userMessageText: text,
      botMessageId: String(sent.message_id),
      botResponseText: generated.text,
    });
  } catch (error) {
    console.error(error);
    addChatContext({ chatId, userId, messageId, text, role: "user" });
    await ctx.reply("не вывез, попробуй еще раз");
  }
});

bot.catch((error, ctx) => {
  console.error(`Bot error for update ${ctx.update.update_id}`, error);
});

bot.launch({ allowedUpdates: ["message", "message_reaction", "message_reaction_count"] });
console.log("ArtemGPT bot started with allowed updates: message,message_reaction,message_reaction_count");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
