import type { Api, Context } from "grammy";
import { getActiveList, getVisibleItems, updateItemMsgId, compactList } from "../db.js";
import { renderShoppingStatus, renderGroupMessage, renderNormalStatus } from "../render.js";
import { editStatusMessage, sendStatusMessage, deleteMessages } from "../status.js";
import { cancelAutoReset } from "./compact.js";
import { logger } from "../logger.js";

// --- Shopping state tracking ---

const shoppingChats = new Set<number>();

export function isShoppingMode(chatId: number): boolean {
  return shoppingChats.has(chatId);
}

export function cancelShoppingMode(chatId: number): void {
  shoppingChats.delete(chatId);
}

/**
 * Core shopping logic: edits status to SHOPPING header and sends one group message
 * per department. Can be called from both the button callback and NL command handlers.
 */
export async function coreStartShopping(chatId: number, api: Api, chatType?: string): Promise<void> {
  const data = getActiveList(chatId);
  if (!data) return;

  const { list } = data;
  const visibleItems = getVisibleItems(list.id);
  if (visibleItems.length === 0) return;

  const completeCount = visibleItems.filter((i) => i.complete).length;
  logger.info("shop", `chat:${chatId} starting shopping, list #${list.id} (${visibleItems.length} visible, ${completeCount} complete)`);

  const groupMap = new Map<string, typeof visibleItems>();
  for (const item of visibleItems) {
    const key = item.group || "Разное";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }

  for (const [groupName, groupItems] of groupMap) {
    try {
      const rendered = renderGroupMessage(groupName, groupItems);
      const msg = await api.sendMessage(chatId, rendered.text, {
        parse_mode: "MarkdownV2",
        reply_markup: rendered.keyboard,
        disable_notification: true,
      });
      for (const item of groupItems) {
        updateItemMsgId(item.id, msg.message_id);
      }
      logger.debug("shop", `chat:${chatId} group "${groupName}" (${groupItems.length} items) sent as msg:${msg.message_id}`);
    } catch (err) {
      logger.error("shop", `chat:${chatId} failed to send group "${groupName}"`, err);
    }
  }

  shoppingChats.add(chatId);

  // Send status at the bottom so [Compact] / [Finish] are easy to reach.
  // In groups, sendStatusMessage also unpins the old status and re-pins the new one.
  const status = renderShoppingStatus(visibleItems);
  await sendStatusMessage(api, chatId, status.text, status.keyboard, chatType);
}

/** Called when user taps [Start Shopping] button */
export async function handleStartShopping(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  const visibleItems = getVisibleItems(data.list.id);
  if (visibleItems.length === 0) {
    await ctx.answerCallbackQuery({ text: "Список пуст" });
    return;
  }

  await coreStartShopping(chatId, ctx.api, ctx.chat.type);
  await ctx.answerCallbackQuery();
}

/** Called when user taps [Finish] — compact completed items silently, return to NORMAL with remaining */
export async function handleFinishShopping(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  cancelAutoReset(chatId);
  cancelShoppingMode(chatId);

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  // Collect unique group message_ids before compacting
  const visibleItems = getVisibleItems(data.list.id);
  const uniqueMsgIds = [...new Set(
    visibleItems.map((i) => i.message_id).filter((id): id is number => id !== null)
  )];

  // Compact: soft-delete all completed items
  compactList(chatId);

  // Delete all group messages from chat
  await deleteMessages(ctx.api, chatId, uniqueMsgIds);

  // Return to NORMAL with remaining (incomplete) items
  const remainingItems = getVisibleItems(data.list.id);
  logger.info("shop", `chat:${chatId} finished shopping, ${remainingItems.length} items remaining`);

  const status = renderNormalStatus(remainingItems);
  await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);

  await ctx.answerCallbackQuery();
}
