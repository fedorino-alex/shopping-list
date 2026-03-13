import type { Context } from "grammy";
import { toggleItem, getActiveList } from "../db.js";
import { renderItemText, renderItemKeyboard, renderHeaderText } from "../render.js";
import { logger } from "../logger.js";

export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const chatId = ctx.chat?.id;

  if (!data || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Parse callback data: "toggle:<item_id>"
  const match = data.match(/^toggle:(\d+)$/);
  if (!match) {
    logger.error("callback", `chat:${chatId} unknown callback data: "${data}"`);
    await ctx.answerCallbackQuery({ text: "Unknown action" });
    return;
  }

  const itemId = parseInt(match[1], 10);

  // Toggle the item in the database
  const item = toggleItem(itemId);
  if (!item) {
    logger.error("callback", `chat:${chatId} item #${itemId} not found`);
    await ctx.answerCallbackQuery({ text: "Item not found" });
    return;
  }

  logger.info(
    "callback",
    `chat:${chatId} toggled item #${item.id} "${item.name}" -> ${item.done ? "done" : "undone"}`,
  );

  // Edit the item message in-place with updated text and keyboard
  try {
    await ctx.editMessageText(renderItemText(item), {
      parse_mode: "MarkdownV2",
      reply_markup: renderItemKeyboard(item),
    });
  } catch (err) {
    logger.error("callback", `chat:${chatId} failed to edit item msg for #${item.id}`, err);
  }

  // Update the header message with the new done counter
  try {
    const listData = getActiveList(chatId);
    if (listData && listData.list.header_msg_id) {
      await ctx.api.editMessageText(
        chatId,
        listData.list.header_msg_id,
        renderHeaderText(listData.items),
        { parse_mode: "MarkdownV2" },
      );
    }
  } catch (err) {
    // Header edit can fail if message hasn't changed (all items same state)
    // or if the header was deleted by the user — this is fine
    logger.error("callback", `chat:${chatId} failed to edit header`, err);
  }

  // Always answer the callback query to dismiss the loading spinner
  await ctx.answerCallbackQuery();
}
