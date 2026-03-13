import type { Context } from "grammy";
import { clearList } from "../db.js";
import { logger } from "../logger.js";

async function deleteMessages(ctx: Context, chatId: number, msgIds: number[]): Promise<void> {
  for (const msgId of msgIds) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch {
      // Message may already be deleted by the user — ignore
      logger.debug("clear", `chat:${chatId} could not delete msg:${msgId}`);
    }
  }
}

export async function handleClearCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const { count, headerMsgId, itemMsgIds } = clearList(chatId);

  if (count === 0) {
    logger.debug("clear", `chat:${chatId} no list to clear`);
    await ctx.reply("No active shopping list\\.", { parse_mode: "MarkdownV2" });
    return;
  }

  // Delete item messages and header from the chat
  const allMsgIds = headerMsgId ? [headerMsgId, ...itemMsgIds] : itemMsgIds;
  await deleteMessages(ctx, chatId, allMsgIds);
  logger.info("clear", `chat:${chatId} cleared ${count} items, deleted ${allMsgIds.length} messages`);

  await ctx.reply(
    `Shopping list cleared \\(${count} item${count > 1 ? "s" : ""} removed\\)\\.`,
    { parse_mode: "MarkdownV2" },
  );
}
