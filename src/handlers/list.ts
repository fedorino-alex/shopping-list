import type { Context } from "grammy";
import { createList, getActiveList, getVisibleItems } from "../db.js";
import { renderAwaitingStatus, renderNormalStatus } from "../render.js";
import { editStatusMessage } from "../status.js";
import { logger } from "../logger.js";

// Chat IDs that are waiting for the user to send a list of items
const awaitingList = new Set<number>();

export function isAwaitingList(chatId: number): boolean {
  return awaitingList.has(chatId);
}

/** Called when user taps [New List] button */
export async function handleNewList(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  awaitingList.add(chatId);
  logger.debug("list", `chat:${chatId} now awaiting list input`);

  const status = renderAwaitingStatus();
  await editStatusMessage(ctx.api, chatId, status.text);
  await ctx.answerCallbackQuery();
}

/** Called when user sends text while in AWAITING_INPUT state */
export async function handleListInput(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;
  if (!chatId || !text) return;

  awaitingList.delete(chatId);

  const items = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (items.length === 0) {
    logger.debug("list", `chat:${chatId} sent empty list`);
    // Stay in awaiting state
    awaitingList.add(chatId);
    const status = renderAwaitingStatus();
    await editStatusMessage(ctx.api, chatId, status.text);
    return;
  }

  // Delete the user's text message to keep the chat clean (modal-like behavior)
  const msgId = ctx.message?.message_id;
  if (msgId) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch {
      // May lack delete permission in groups -- ignore
    }
  }

  const listId = createList(chatId, items);
  logger.info("list", `chat:${chatId} created list #${listId} with ${items.length} items: [${items.join(", ")}]`);

  // Move to NORMAL state
  const visibleItems = getVisibleItems(listId);
  const status = renderNormalStatus(visibleItems);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
}
