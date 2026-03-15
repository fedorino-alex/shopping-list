import type { Api } from "grammy";
import { getChat, updateStatusMsgId, clearStatusMsgId } from "./db.js";
import { logger } from "./logger.js";
import type { InlineKeyboard } from "grammy";

/**
 * Unpin (in groups) and delete the persistent status message, then clear it from DB.
 * Used when clearing the list — no new status message is sent.
 */
export async function deleteStatusMessage(
  api: Api,
  chatId: number,
  chatType?: string,
): Promise<void> {
  const chat = getChat(chatId);
  if (!chat.status_msg_id) return;

  if (chatType === "group" || chatType === "supergroup") {
    try {
      await api.unpinChatMessage(chatId, chat.status_msg_id);
    } catch {
      // No permission or already unpinned
    }
  }
  try {
    await api.deleteMessage(chatId, chat.status_msg_id);
  } catch {
    // Already deleted
  }
  clearStatusMsgId(chatId);
}

/**
 * Edit the persistent status message in-place.
 * If the edit fails (message deleted, too old, etc.), send a new one and update the DB.
 */
export async function editStatusMessage(
  api: Api,
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const chat = getChat(chatId);
  const msgId = chat.status_msg_id;

  if (msgId) {
    try {
      await api.editMessageText(chatId, msgId, text, {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });
      return;
    } catch {
      // Edit failed — message may be deleted or too old. Send a new one.
      logger.debug("status", `chat:${chatId} could not edit status msg:${msgId}, sending new`);
    }
  }

  // No existing message or edit failed — send a new one
  const msg = await api.sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
  updateStatusMsgId(chatId, msg.message_id);
}

/**
 * Send a fresh status message (e.g. on /start or group join). Deletes the old one if it exists.
 * Pass `chatType` to auto-pin the message in group chats.
 */
export async function sendStatusMessage(
  api: Api,
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
  chatType?: string,
): Promise<void> {
  const chat = getChat(chatId);

  // Unpin + delete old status message
  if (chat.status_msg_id) {
    if (chatType === "group" || chatType === "supergroup") {
      try {
        await api.unpinChatMessage(chatId, chat.status_msg_id);
      } catch {
        // No permission or already unpinned — ignore
      }
    }
    try {
      await api.deleteMessage(chatId, chat.status_msg_id);
    } catch {
      // Already deleted — ignore
    }
  }

  const msg = await api.sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
  updateStatusMsgId(chatId, msg.message_id);

  // Auto-pin in group chats (non-fatal if bot lacks permission)
  if (chatType === "group" || chatType === "supergroup") {
    try {
      await api.pinChatMessage(chatId, msg.message_id, { disable_notification: true });
    } catch {
      logger.debug("status", `chat:${chatId} could not pin status message (no permission?)`);
    }
  }
}

/**
 * Delete Telegram messages by IDs, ignoring failures.
 */
export async function deleteMessages(api: Api, chatId: number, msgIds: number[]): Promise<void> {
  for (const msgId of msgIds) {
    try {
      await api.deleteMessage(chatId, msgId);
    } catch {
      // Message may already be deleted — ignore
    }
  }
}
