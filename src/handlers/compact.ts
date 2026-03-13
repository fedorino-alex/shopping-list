import type { Api } from "grammy";
import { clearList, compactList, getActiveList, getVisibleItems } from "../db.js";
import { renderShoppingStatus, renderIdleStatus, escapeMarkdown } from "../render.js";
import { editStatusMessage, deleteMessages } from "../status.js";
import { logger } from "../logger.js";
import type { Context } from "grammy";

// --- Auto-reset timers (in-memory, lost on restart) ---

const AUTO_RESET_DELAY_MS = 5 * 60 * 1000; // 5 minutes

interface PendingReset {
  timeout: NodeJS.Timeout;
  confirmMsgId?: number;
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

/** Schedule silent auto-reset: deletes all Telegram messages and soft-deletes the list. */
export function scheduleAutoReset(chatId: number, api: Api, confirmMsgId?: number): void {
  cancelAutoReset(chatId);

  const timeout = setTimeout(async () => {
    pendingResets.delete(chatId);
    logger.info("compact", `chat:${chatId} auto-reset triggered`);

    const result = clearList(chatId);
    const allMsgIds = [...result.itemMsgIds];
    if (confirmMsgId) allMsgIds.push(confirmMsgId);

    await deleteMessages(api, chatId, allMsgIds);

    // Edit status message back to IDLE
    const status = renderIdleStatus();
    await editStatusMessage(api, chatId, status.text, status.keyboard);

    logger.info("compact", `chat:${chatId} auto-reset complete, deleted ${allMsgIds.length} messages`);
  }, AUTO_RESET_DELAY_MS);

  pendingResets.set(chatId, { timeout, confirmMsgId });
  logger.debug("compact", `chat:${chatId} auto-reset scheduled in ${AUTO_RESET_DELAY_MS / 1000}s`);
}

// --- [Compact] button handler ---

/** Called when user taps [Compact] button */
export async function handleCompact(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  const result = compactList(chatId);
  if (!result) {
    await ctx.answerCallbackQuery({ text: "No active list" });
    return;
  }

  if (result.hiddenCount === 0 && !result.allComplete) {
    logger.debug("compact", `chat:${chatId} nothing to compact`);
    await ctx.answerCallbackQuery({ text: "Nothing to compact" });
    return;
  }

  if (result.allComplete) {
    // All items done — keep messages visible, schedule auto-reset
    logger.info("compact", `chat:${chatId} all items complete, scheduling auto-reset`);
    const confirmMsg = await ctx.api.sendMessage(
      chatId,
      escapeMarkdown("All done! List will auto-clear in 5 minutes."),
      { parse_mode: "MarkdownV2" },
    );
    scheduleAutoReset(chatId, ctx.api, confirmMsg.message_id);
    await ctx.answerCallbackQuery();
    return;
  }

  // Some items still active — hide completed items from chat
  await deleteMessages(ctx.api, chatId, result.hiddenMsgIds);
  logger.info("compact", `chat:${chatId} compacted ${result.hiddenCount} items, deleted ${result.hiddenMsgIds.length} messages`);

  // Update the status/header message with remaining visible items
  const freshData = getActiveList(chatId);
  if (freshData) {
    const visibleItems = getVisibleItems(freshData.list.id);
    const status = renderShoppingStatus(visibleItems);
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  }

  await ctx.answerCallbackQuery();
}
