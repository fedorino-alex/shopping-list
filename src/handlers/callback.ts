import type { Context } from "grammy";
import { toggleItem, getActiveList, getVisibleItems } from "../db.js";
import { renderItemText, renderItemKeyboard, renderShoppingStatus } from "../render.js";
import { editStatusMessage } from "../status.js";
import { logger } from "../logger.js";
import { handleNewList } from "./list.js";
import { handleStartShopping, handleFinishShopping } from "./shop.js";
import { handleClearList } from "./clear.js";
import { handleCompact, scheduleAutoReset, cancelAutoReset } from "./compact.js";
import { handleEditList, handleDoneEditing, handleAddItems, handleRemoveItem } from "./edit.js";

/** Routes all callback queries to the appropriate handler. */
export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const chatId = ctx.chat?.id;

  if (!data || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Route action callbacks
  if (data === "action:new_list") {
    return handleNewList(ctx);
  }
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
  if (data === "action:edit_list") {
    return handleEditList(ctx);
  }
  if (data === "action:done_editing") {
    return handleDoneEditing(ctx);
  }
  if (data === "action:add_items") {
    return handleAddItems(ctx);
  }

  // Route toggle callbacks
  const match = data.match(/^toggle:(\d+)$/);
  if (match) {
    return handleToggle(ctx, chatId, parseInt(match[1], 10));
  }

  // Route remove callbacks
  const removeMatch = data.match(/^remove:(\d+)$/);
  if (removeMatch) {
    return handleRemoveItem(ctx, chatId, parseInt(removeMatch[1], 10));
  }

  logger.error("callback", `chat:${chatId} unknown callback data: "${data}"`);
  await ctx.answerCallbackQuery({ text: "Неизвестное действие" });
}

/** Handles a toggle:<item_id> callback — flips complete state, edits message, updates header. */
async function handleToggle(ctx: Context, chatId: number, itemId: number): Promise<void> {
  const item = toggleItem(itemId);
  if (!item) {
    logger.error("callback", `chat:${chatId} item #${itemId} not found`);
    await ctx.answerCallbackQuery({ text: "Товар не найден" });
    return;
  }

  logger.info(
    "callback",
    `chat:${chatId} toggled item #${item.id} "${item.name}" -> ${item.complete ? "complete" : "active"}`,
  );

  // Edit the item message in-place
  try {
    await ctx.editMessageText(renderItemText(item), {
      parse_mode: "MarkdownV2",
      reply_markup: renderItemKeyboard(item),
    });
  } catch (err) {
    logger.error("callback", `chat:${chatId} failed to edit item msg for #${item.id}`, err);
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
