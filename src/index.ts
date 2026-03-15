import "dotenv/config";
import { Bot } from "grammy";

import { logger } from "./logger.js";
import { getActiveList, getVisibleItems, getStatusMsgId } from "./db.js";
import { renderIdleStatus, renderNormalStatus } from "./render.js";
import { sendStatusMessage } from "./status.js";
import { handleCallbackQuery } from "./handlers/callback.js";
import { handleNLCommand } from "./handlers/nlcommand.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in .env file");
}

const bot = new Bot(token);

// Bot username — resolved at startup, used for @mention detection in groups
let botUsername = "";

// --- /start: the only slash command — creates the initial status message ---

bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/start from chat:${chatId} user:${user}`);

  const data = getActiveList(chatId);
  if (data) {
    const visibleItems = getVisibleItems(data.list.id);
    const status = renderNormalStatus(visibleItems);
    await sendStatusMessage(ctx.api, chatId, status.text, status.keyboard, chatType);
  } else {
    const status = renderIdleStatus();
    await sendStatusMessage(ctx.api, chatId, status.text, status.keyboard, chatType);
  }
});

// --- Auto-init when bot is added to a group ---

bot.on("my_chat_member", async (ctx) => {
  const newStatus = ctx.myChatMember.new_chat_member.status;
  if (newStatus !== "member" && newStatus !== "administrator") return;

  const chatType = ctx.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") return;

  const chatId = ctx.chat.id;
  logger.info("group", `bot added to ${chatType} chat:${chatId} — joining silently`);
  // No status message on join: bot stays silent until someone @mentions it
});

// --- Callback queries (all button presses) ---

bot.on("callback_query:data", (ctx) => {
  logger.debug("callback", `chat:${ctx.chat?.id} data="${ctx.callbackQuery.data}"`);
  return handleCallbackQuery(ctx);
});

// --- Text messages: NL classification for private chats + group @mention/reply-to-status ---

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

  if (isGroup) {
    // Check for @mention
    const entities = ctx.message.entities ?? [];
    const mentionEntity = entities.find(
      (e) => e.type === "mention" && text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
    );
    if (mentionEntity) {
      const stripped = text
        .slice(0, mentionEntity.offset)
        .concat(text.slice(mentionEntity.offset + mentionEntity.length))
        .trim();
      logger.debug("text", `chat:${chatId} @mention: "${stripped.slice(0, 80)}"`);
      await handleNLCommand(ctx, stripped || text);
      return;
    }

    // Check for reply-to-status
    const replyToId = ctx.message.reply_to_message?.message_id;
    if (replyToId && replyToId === getStatusMsgId(chatId)) {
      logger.debug("text", `chat:${chatId} reply-to-status: "${text.slice(0, 80)}"`);
      await handleNLCommand(ctx, text);
      return;
    }

    // Ignore all other group messages
    return;
  }

  // Private chat: all text goes through NL classification
  logger.debug("text", `chat:${chatId} private text: "${text.slice(0, 80)}"`);
  await handleNLCommand(ctx, text);
});

// --- Error handling ---

bot.catch((err) => {
  logger.error("bot", "Unhandled error", err);
});

// --- Startup ---

bot.start();
bot.api.getMe().then((me) => {
  botUsername = me.username ?? "";
  logger.info("bot", `Started as @${me.username} (id:${me.id})`);
}).catch(() => {
  logger.info("bot", "Started (could not fetch bot info)");
});
