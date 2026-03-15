import type { Context } from "grammy";
import { toggleItem, getActiveList, getVisibleItems, getItemsByGroup } from "../db.js";
import { renderGroupMessage, renderShoppingStatus } from "../render.js";
import { editStatusMessage } from "../status.js";
import { logger } from "../logger.js";
import { handleStartShopping, handleFinishShopping } from "./shop.js";
import { handleClearList } from "./clear.js";
import { handleCompact, scheduleAutoReset, cancelAutoReset } from "./compact.js";

/** Routes all callback queries to the appropriate handler. */
export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const chatId = ctx.chat?.id;

  if (!data || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Route action callbacks
  if (data === "action:start_shopping") {
    return handleStartShopping(ctx);
  }
  if (data === "action:clear_list") {
    return handleClearList(ctx);
  }
  if (data === "action:compact") {
    return handleCompact(ctx);
  }
  if (data === "action:finish_shopping") {
    return handleFinishShopping(ctx);
  }
  // Route toggle callbacks
  const match = data.match(/^toggle:(\d+)$/);
  if (match) {
    return handleToggle(ctx, chatId, parseInt(match[1], 10));
  }

  logger.error("callback", `chat:${chatId} unknown callback data: "${data}"`);
  await ctx.answerCallbackQuery({ text: "Неизвестное действие" });
}

/** Handles a toggle:<item_id> callback — flips complete state, re-renders group message, updates header. */
async function handleToggle(ctx: Context, chatId: number, itemId: number): Promise<void> {
  const item = toggleItem(itemId);
  if (!item) {
    logger.error("callback", `chat:${chatId} item #${itemId} not found`);
    await ctx.answerCallbackQuery({ text: "Товар не найден" });
    return;
  }

  logger.info(
    "callback",
    `chat:${chatId} toggled item #${item.id} "${item.code}" -> ${item.complete ? "complete" : "active"}`,
  );

  // Re-render the whole group message with the updated state
  const groupName = item.group || "Разное";
  const groupItems = getItemsByGroup(item.list_id, groupName);
  const rendered = renderGroupMessage(groupName, groupItems);

  try {
    await ctx.api.editMessageText(chatId, item.message_id!, rendered.text, {
      parse_mode: "MarkdownV2",
      reply_markup: rendered.keyboard,
    });
  } catch (err) {
    logger.error("callback", `chat:${chatId} failed to edit group msg for item #${item.id}`, err);
  }

  // Update the status/header message with new counter
  const listData = getActiveList(chatId);
  if (listData) {
    const visibleItems = getVisibleItems(listData.list.id);

    const status = renderShoppingStatus(visibleItems);
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

    // Check if all visible items are now complete — schedule auto-reset
    if (visibleItems.length > 0 && visibleItems.every((i) => i.complete)) {
      logger.info("callback", `chat:${chatId} all visible items complete, scheduling auto-reset`);
      scheduleAutoReset(chatId, ctx.api);
    } else {
      // Not all complete — cancel any pending auto-reset (e.g. user tapped Undo)
      cancelAutoReset(chatId);
    }
  }

  await ctx.answerCallbackQuery();
}
