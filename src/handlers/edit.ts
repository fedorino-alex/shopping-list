import type { Context } from "grammy";
import {
  getActiveList,
  getVisibleItems,
  updateItemMsgId,
  removeItem,
  addItemsToList,
} from "../db.js";
import {
  renderEditingStatus,
  renderAwaitingAddStatus,
  renderNormalStatus,
  renderItemText,
  renderItemRemoveKeyboard,
} from "../render.js";
import { editStatusMessage, deleteMessages } from "../status.js";
import { cancelAutoReset } from "./compact.js";
import { extractItems } from "../extractor.js";
import { logger } from "../logger.js";

// -- In-memory state --

/** Chat IDs currently in EDITING state */
const editingChats = new Set<number>();

/** Chat IDs that are waiting for the user to send items to add */
const awaitingAdd = new Set<number>();

export function isAwaitingAdd(chatId: number): boolean {
  return awaitingAdd.has(chatId);
}

export function isEditingList(chatId: number): boolean {
  return editingChats.has(chatId);
}

/** Called by other handlers when the list is cleared or a new list is created,
 *  to clean up any stale edit state. */
export function cancelEditState(chatId: number): void {
  editingChats.delete(chatId);
  awaitingAdd.delete(chatId);
}

// -- Handlers --

/** Called when user taps [✏️ Изменить список] button (from NORMAL state) */
export async function handleEditList(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  const visibleItems = getVisibleItems(data.list.id);

  awaitingAdd.delete(chatId); // clear any stale add-awaiting state
  editingChats.add(chatId);
  cancelAutoReset(chatId);

  logger.info("edit", `chat:${chatId} entering EDITING, ${visibleItems.length} visible items`);

  // Update status message to EDITING
  const status = renderEditingStatus(visibleItems.length);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  // Send one message per item with [🗑 Удалить] keyboard
  for (const item of visibleItems) {
    try {
      const msg = await ctx.api.sendMessage(chatId, renderItemText(item), {
        parse_mode: "MarkdownV2",
        reply_markup: renderItemRemoveKeyboard(item),
        disable_notification: true,
      });
      updateItemMsgId(item.id, msg.message_id);
      logger.debug("edit", `chat:${chatId} item #${item.id} sent as msg:${msg.message_id}`);
    } catch (err) {
      logger.error("edit", `chat:${chatId} failed to send item #${item.id}`, err);
    }
  }

  await ctx.answerCallbackQuery();
}

/** Called when user taps [💾 Готово] button */
export async function handleDoneEditing(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  awaitingAdd.delete(chatId);
  editingChats.delete(chatId);

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  const visibleItems = getVisibleItems(data.list.id);
  logger.info("edit", `chat:${chatId} done editing, ${visibleItems.length} visible items`);

  // Delete the per-item messages we sent during EDITING, then show NORMAL status
  const msgIds = visibleItems
    .map((i) => i.message_id)
    .filter((id): id is number => id !== null);
  await deleteMessages(ctx.api, chatId, msgIds);

  const status = renderNormalStatus(visibleItems);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  await ctx.answerCallbackQuery();
}

/** Called when user taps [Remove] on an item message */
export async function handleRemoveItem(ctx: Context, chatId: number, itemId: number): Promise<void> {
  const item = removeItem(itemId);
  if (!item) {
    logger.error("edit", `chat:${chatId} item #${itemId} not found for removal`);
    await ctx.answerCallbackQuery({ text: "Товар не найден" });
    return;
  }

  logger.info("edit", `chat:${chatId} removed item #${item.id} "${item.name}"`);

  // Delete the item's Telegram message
  if (item.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, item.message_id);
    } catch (err) {
      logger.error("edit", `chat:${chatId} failed to delete msg for item #${item.id}`, err);
    }
  }

  // Update the status counter
  const data = getActiveList(chatId);
  const count = data ? getVisibleItems(data.list.id).length : 0;
  const status = renderEditingStatus(count);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  await ctx.answerCallbackQuery();
}

/** Called when user taps [Add Items] button */
export async function handleAddItems(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  awaitingAdd.add(chatId);
  logger.debug("edit", `chat:${chatId} awaiting add-items input`);

  const status = renderAwaitingAddStatus();
  await editStatusMessage(ctx.api, chatId, status.text);
  await ctx.answerCallbackQuery();
}

/** Called when user sends text while in AWAITING_ADD state */
export async function handleAddItemsInput(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;
  if (!chatId || !text) return;

  awaitingAdd.delete(chatId);

  const names = await extractItems(text);

  if (names.length === 0) {
    // Stay in awaiting-add state
    awaitingAdd.add(chatId);
    const status = renderAwaitingAddStatus();
    await editStatusMessage(ctx.api, chatId, status.text);
    return;
  }

  // Delete the user's text message to keep the chat clean
  const msgId = ctx.message?.message_id;
  if (msgId) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch {
      // May lack delete permission in groups — ignore
    }
  }

  const data = getActiveList(chatId);
  if (!data) {
    logger.error("edit", `chat:${chatId} no active list when adding items`);
    return;
  }

  const newItems = addItemsToList(data.list.id, chatId, names);
  logger.info("edit", `chat:${chatId} added ${newItems.length} items: [${names.join(", ")}]`);

  // Send a message per new item with [Remove] keyboard
  for (const item of newItems) {
    try {
      const msg = await ctx.api.sendMessage(chatId, renderItemText(item), {
        parse_mode: "MarkdownV2",
        reply_markup: renderItemRemoveKeyboard(item),
        disable_notification: true,
      });
      updateItemMsgId(item.id, msg.message_id);
      logger.debug("edit", `chat:${chatId} new item #${item.id} sent as msg:${msg.message_id}`);
    } catch (err) {
      logger.error("edit", `chat:${chatId} failed to send new item #${item.id}`, err);
    }
  }

  // Return status to EDITING with updated count
  const visibleItems = getVisibleItems(data.list.id);
  const status = renderEditingStatus(visibleItems.length);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
}
