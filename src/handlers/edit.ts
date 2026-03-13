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
  renderItemKeyboard,
  renderItemRemoveKeyboard,
  renderShoppingStatus,
} from "../render.js";
import { editStatusMessage, deleteMessages } from "../status.js";
import { cancelAutoReset, scheduleAutoReset } from "./compact.js";
import { logger } from "../logger.js";

// -- In-memory state --

type EditOrigin = "normal" | "shopping";

/** Tracks which state the user was in before entering EDITING */
const editOrigin = new Map<number, EditOrigin>();

/** Chat IDs that are waiting for the user to send items to add */
const awaitingAdd = new Set<number>();

export function isAwaitingAdd(chatId: number): boolean {
  return awaitingAdd.has(chatId);
}

export function isEditingList(chatId: number): boolean {
  return editOrigin.has(chatId);
}

/** Called by other handlers when the list is cleared or a new list is created,
 *  to clean up any stale edit state. */
export function cancelEditState(chatId: number): void {
  editOrigin.delete(chatId);
  awaitingAdd.delete(chatId);
}

// -- Handlers --

/** Called when user taps [Edit List] button (from NORMAL or SHOPPING state) */
export async function handleEditList(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  const visibleItems = getVisibleItems(data.list.id);

  // Determine origin: if any visible item already has a message_id it was sent
  // during Start Shopping, so we came from SHOPPING. Otherwise NORMAL.
  const origin: EditOrigin = visibleItems.some((i) => i.message_id !== null)
    ? "shopping"
    : "normal";

  editOrigin.set(chatId, origin);
  awaitingAdd.delete(chatId); // clear any stale add-awaiting state

  // Cancel any pending auto-reset (e.g. user editing after all items done)
  cancelAutoReset(chatId);

  logger.info("edit", `chat:${chatId} entering EDITING from ${origin}, ${visibleItems.length} visible items`);

  // Update status message to EDITING
  const status = renderEditingStatus(visibleItems.length);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  if (origin === "normal") {
    // Items have no Telegram messages yet — send one per item with [Remove] keyboard
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
  } else {
    // Items already have Telegram messages from Start Shopping — swap to [Remove] keyboard
    for (const item of visibleItems) {
      if (!item.message_id) continue;
      try {
        await ctx.api.editMessageReplyMarkup(chatId, item.message_id, {
          reply_markup: renderItemRemoveKeyboard(item),
        });
      } catch (err) {
        logger.error("edit", `chat:${chatId} failed to edit keyboard for item #${item.id}`, err);
      }
    }
  }

  await ctx.answerCallbackQuery();
}

/** Called when user taps [Done Editing] button */
export async function handleDoneEditing(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const origin = editOrigin.get(chatId) ?? "normal";
  editOrigin.delete(chatId);
  awaitingAdd.delete(chatId);

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  const visibleItems = getVisibleItems(data.list.id);
  logger.info("edit", `chat:${chatId} done editing (origin:${origin}), ${visibleItems.length} visible items`);

  if (origin === "normal") {
    // Delete the per-item messages we sent during EDITING, then show NORMAL status
    const msgIds = visibleItems
      .map((i) => i.message_id)
      .filter((id): id is number => id !== null);
    await deleteMessages(ctx.api, chatId, msgIds);

    const status = renderNormalStatus(visibleItems);
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  } else {
    // Restore Done/Undo keyboards on each visible item message
    for (const item of visibleItems) {
      if (!item.message_id) continue;
      try {
        await ctx.api.editMessageText(chatId, item.message_id, renderItemText(item), {
          parse_mode: "MarkdownV2",
          reply_markup: renderItemKeyboard(item),
        });
      } catch (err) {
        logger.error("edit", `chat:${chatId} failed to restore keyboard for item #${item.id}`, err);
      }
    }

    // Return to SHOPPING status
    const status = renderShoppingStatus(visibleItems);
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

    // Re-check if all visible items are complete (e.g. user removed remaining incomplete items)
    if (visibleItems.length > 0 && visibleItems.every((i) => i.complete)) {
      logger.info("edit", `chat:${chatId} all visible items complete after editing, scheduling auto-reset`);
      scheduleAutoReset(chatId, ctx.api);
    }
  }

  await ctx.answerCallbackQuery();
}

/** Called when user taps [Remove] on an item message */
export async function handleRemoveItem(ctx: Context, chatId: number, itemId: number): Promise<void> {
  const item = removeItem(itemId);
  if (!item) {
    logger.error("edit", `chat:${chatId} item #${itemId} not found for removal`);
    await ctx.answerCallbackQuery({ text: "Item not found" });
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

  const names = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
