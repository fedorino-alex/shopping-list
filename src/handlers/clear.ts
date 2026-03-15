import type { Context } from "grammy";
import { clearList } from "../db.js";
import { editStatusMessage, deleteStatusMessage, deleteMessages } from "../status.js";
import { renderIdleStatus } from "../render.js";
import { logger } from "../logger.js";
import { cancelAutoReset } from "./compact.js";
import { cancelShoppingMode } from "./shop.js";

/** Called when user taps [Clear List] button */
export async function handleClearList(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Cancel any pending auto-reset timer
  cancelAutoReset(chatId);
  cancelShoppingMode(chatId);

  const { count, itemMsgIds } = clearList(chatId);

  if (count === 0) {
    await ctx.answerCallbackQuery({ text: "Нет активного списка" });
    return;
  }

  // Delete item messages from chat
  await deleteMessages(ctx.api, chatId, itemMsgIds);
  logger.info("clear", `chat:${chatId} cleared ${count} items, deleted ${itemMsgIds.length} messages`);

  const chatType = ctx.chat?.type;
  if (chatType === "group" || chatType === "supergroup") {
    // Group: unpin + delete status entirely
    await deleteStatusMessage(ctx.api, chatId, chatType);
  } else {
    // Private: show IDLE status — persistent UI stays visible
    const status = renderIdleStatus();
    await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
  }

  await ctx.answerCallbackQuery();
}
