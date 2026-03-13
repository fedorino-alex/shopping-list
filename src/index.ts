import "dotenv/config";
import { Bot } from "grammy";

import { logger } from "./logger.js";
import { getActiveList, getVisibleItems } from "./db.js";
import { renderIdleStatus, renderNormalStatus } from "./render.js";
import { sendStatusMessage } from "./status.js";
import { handleCallbackQuery } from "./handlers/callback.js";
import { isAwaitingList, handleListInput } from "./handlers/list.js";
import { isAwaitingAdd, handleAddItemsInput } from "./handlers/edit.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in .env file");
}

const bot = new Bot(token);

// --- /start: the only slash command — creates the initial status message ---

bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/start from chat:${chatId} user:${user}`);

  const data = getActiveList(chatId);
  if (data) {
    // List exists — show NORMAL state with all visible items
    const visibleItems = getVisibleItems(data.list.id);
    const status = renderNormalStatus(visibleItems);
    await sendStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  } else {
    // No list — show IDLE state
    const status = renderIdleStatus();
    await sendStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  }
});

// --- Callback queries (all button presses) ---

bot.on("callback_query:data", (ctx) => {
  logger.debug("callback", `chat:${ctx.chat?.id} data="${ctx.callbackQuery.data}"`);
  return handleCallbackQuery(ctx);
});

// --- Text messages (only processed when awaiting list input) ---

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;

  if (isAwaitingList(chatId)) {
    logger.debug("text", `chat:${chatId} list input: "${ctx.message.text.slice(0, 80)}"`);
    await handleListInput(ctx);
    return;
  }

  if (isAwaitingAdd(chatId)) {
    logger.debug("text", `chat:${chatId} add-items input: "${ctx.message.text.slice(0, 80)}"`);
    await handleAddItemsInput(ctx);
    return;
  }

  // Ignore unrecognized text
});

// --- Error handling ---

bot.catch((err) => {
  logger.error("bot", "Unhandled error", err);
});

// --- Startup ---

bot.start();
bot.api.getMe().then((me) => {
  logger.info("bot", `Started as @${me.username} (id:${me.id})`);
}).catch(() => {
  logger.info("bot", "Started (could not fetch bot info)");
});
