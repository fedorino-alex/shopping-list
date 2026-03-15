import type { Api } from "grammy";
import { clearList, compactList, getActiveList, getVisibleItems, getItemsByGroup } from "../db.js";
import { renderShoppingStatus, renderIdleStatus, renderGroupMessage } from "../render.js";
import { editStatusMessage, deleteMessages } from "../status.js";
import { logger } from "../logger.js";
import type { Context } from "grammy";
import { cancelShoppingMode } from "./shop.js";

// --- Auto-reset timers (in-memory, lost on restart) ---

const AUTO_RESET_DELAY_MS = 30 * 1000; // 30 seconds

interface PendingReset {
  timeout: NodeJS.Timeout;
}

const pendingResets = new Map<number, PendingReset>();

/** Cancel a pending auto-reset for a chat (called by clear and new list). */
export function cancelAutoReset(chatId: number): void {
  const pending = pendingResets.get(chatId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingResets.delete(chatId);
    logger.debug("compact", `chat:${chatId} auto-reset cancelled`);
  }
}

/** Schedule silent auto-reset: deletes all item messages and soft-deletes the list. */
export function scheduleAutoReset(chatId: number, api: Api): void {
  cancelAutoReset(chatId);

  const timeout = setTimeout(async () => {
    pendingResets.delete(chatId);
    logger.info("compact", `chat:${chatId} auto-reset triggered`);

    const result = clearList(chatId);
    cancelShoppingMode(chatId);
    await deleteMessages(api, chatId, result.itemMsgIds);

    // Edit status message back to IDLE
    const status = renderIdleStatus();
    await editStatusMessage(api, chatId, status.text, status.keyboard);

    logger.info("compact", `chat:${chatId} auto-reset complete, deleted ${result.itemMsgIds.length} messages`);
  }, AUTO_RESET_DELAY_MS);

  pendingResets.set(chatId, { timeout });
  logger.debug("compact", `chat:${chatId} auto-reset scheduled in ${AUTO_RESET_DELAY_MS / 1000}s`);
}

// --- [Compact] button handler ---

/** Called when user taps [Compact] button */
export async function handleCompact(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  const result = compactList(chatId);
  if (!result) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  if (result.hiddenCount === 0 && !result.allComplete) {
    logger.debug("compact", `chat:${chatId} nothing to compact`);
    await ctx.answerCallbackQuery({ text: "Нечего скрывать" });
    return;
  }

  if (result.allComplete) {
    // All items done — silently schedule auto-reset
    logger.info("compact", `chat:${chatId} all items complete, scheduling auto-reset`);
    scheduleAutoReset(chatId, ctx.api);
    await ctx.answerCallbackQuery();
    return;
  }

  // Delete group messages where all items were bought
  await deleteMessages(ctx.api, chatId, result.deletedMsgIds);
  logger.info("compact", `chat:${chatId} compacted ${result.hiddenCount} items, deleted ${result.deletedMsgIds.length} group messages`);

  // Re-render group messages that still have remaining items
  const freshData = getActiveList(chatId);
  if (freshData) {
    for (const { msgId, groupName } of result.updatedGroups) {
      const remainingItems = getItemsByGroup(freshData.list.id, groupName);
      if (remainingItems.length > 0) {
        const rendered = renderGroupMessage(groupName, remainingItems);
        try {
          await ctx.api.editMessageText(chatId, msgId, rendered.text, {
            parse_mode: "MarkdownV2",
            reply_markup: rendered.keyboard,
          });
        } catch (err) {
          logger.error("compact", `chat:${chatId} failed to edit group msg ${msgId} for "${groupName}"`, err);
        }
      }
    }

    // Update status header
    const visibleItems = getVisibleItems(freshData.list.id);
    const status = renderShoppingStatus(visibleItems);
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  }

  await ctx.answerCallbackQuery();
}
