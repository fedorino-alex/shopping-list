import "dotenv/config";
import { Bot } from "grammy";

import { logger } from "./logger.js";
import { handleListCommand, handleListInput, isAwaitingList } from "./handlers/list.js";
import { handleClearCommand } from "./handlers/clear.js";
import { handleShopCommand } from "./handlers/shop.js";
import { handleCallbackQuery } from "./handlers/callback.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in .env file");
}

const bot = new Bot(token);

// --- Commands ---

bot.command("start", (ctx) => {
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/start from chat:${ctx.chat.id} user:${user}`);
  return ctx.reply(
    "Shopping List Bot\\!\n\n"
      + "/list \\- create a new shopping list\n"
      + "/shop \\- display your list with buttons\n"
      + "/clear \\- clear the current list",
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("list", (ctx) => {
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/list from chat:${ctx.chat.id} user:${user}`);
  return handleListCommand(ctx);
});

bot.command("shop", (ctx) => {
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/shop from chat:${ctx.chat.id} user:${user}`);
  return handleShopCommand(ctx);
});

bot.command("clear", (ctx) => {
  const user = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  logger.info("cmd", `/clear from chat:${ctx.chat.id} user:${user}`);
  return handleClearCommand(ctx);
});

// --- Callback queries (inline button presses) ---

bot.on("callback_query:data", (ctx) => {
  logger.debug("callback", `chat:${ctx.chat?.id} data="${ctx.callbackQuery.data}"`);
  return handleCallbackQuery(ctx);
});

// --- Text messages ---

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const awaiting = isAwaitingList(chatId);

  logger.debug("text", `chat:${chatId} awaiting=${awaiting} text="${ctx.message.text.slice(0, 80)}"`);

  if (awaiting) {
    await handleListInput(ctx);
    return;
  }

  // Ignore unrecognized text for now
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
