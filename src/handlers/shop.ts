import type { Context } from "grammy";
import { getActiveList, getVisibleItems, updateItemMsgId, compactList } from "../db.js";
import { renderShoppingStatus, renderItemText, renderItemKeyboard, renderNormalStatus } from "../render.js";
import { editStatusMessage, deleteMessages } from "../status.js";
import { cancelAutoReset } from "./compact.js";
import { logger } from "../logger.js";

/** Called when user taps [Start Shopping] button */
export async function handleStartShopping(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  const { list } = data;
  const visibleItems = getVisibleItems(list.id);

  if (visibleItems.length === 0) {
    await ctx.answerCallbackQuery({ text: "No items in list" });
    return;
  }

  const completeCount = visibleItems.filter((i) => i.complete).length;
  logger.info("shop", `chat:${chatId} starting shopping, list #${list.id} (${visibleItems.length} visible, ${completeCount} complete)`);

  // Edit the status message to become the shopping header
  const status = renderShoppingStatus(visibleItems);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  // Send one message per visible item with an inline button
  for (const item of visibleItems) {
    try {
      const msg = await ctx.api.sendMessage(chatId, renderItemText(item), {
        parse_mode: "MarkdownV2",
        reply_markup: renderItemKeyboard(item),
        disable_notification: true,
      });
      updateItemMsgId(item.id, msg.message_id);
      logger.debug("shop", `chat:${chatId} item #${item.id} "${item.name}" sent as msg:${msg.message_id}`);
    } catch (err) {
      logger.error("shop", `chat:${chatId} failed to send item #${item.id} "${item.name}"`, err);
    }
  }

  await ctx.answerCallbackQuery();
}

/** Called when user taps [Finish] — compact completed items silently, return to NORMAL with remaining */
export async function handleFinishShopping(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  cancelAutoReset(chatId);

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  // Collect all visible item message_ids before compacting
  const visibleItems = getVisibleItems(data.list.id);
  const allMsgIds = visibleItems
    .map((i) => i.message_id)
    .filter((id): id is number => id !== null);

  // Compact: soft-delete all completed items
  compactList(chatId);

  // Delete all item messages from chat
  await deleteMessages(ctx.api, chatId, allMsgIds);

  // Return to NORMAL with remaining (incomplete) items — ready for the next store
  const remainingItems = getVisibleItems(data.list.id);
  logger.info("shop", `chat:${chatId} finished shopping, ${remainingItems.length} items remaining`);

  const status = renderNormalStatus(remainingItems);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  await ctx.answerCallbackQuery();
}
