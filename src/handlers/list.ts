import type { Context } from "grammy";
import { createList, getActiveList, clearList } from "../db.js";
import { logger } from "../logger.js";

// Chat IDs that are waiting for the user to send a list of items
const awaitingList = new Set<number>();

export function isAwaitingList(chatId: number): boolean {
  return awaitingList.has(chatId);
}

export async function handleListCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  awaitingList.add(chatId);
  logger.debug("list", `chat:${chatId} now awaiting list input`);

  await ctx.reply("Send me a comma\\-separated list of items to buy\\.", {
    parse_mode: "MarkdownV2",
  });
}

/** Delete old list's Telegram messages before creating a new one. */
async function deleteOldListMessages(ctx: Context, chatId: number): Promise<void> {
  const oldData = getActiveList(chatId);
  if (!oldData) return;

  const { list, items } = oldData;
  const msgIds: number[] = [];
  if (list.header_msg_id) msgIds.push(list.header_msg_id);
  for (const item of items) {
    if (item.message_id) msgIds.push(item.message_id);
  }

  if (msgIds.length === 0) return;

  logger.debug("list", `chat:${chatId} deleting ${msgIds.length} messages from old list #${list.id}`);
  for (const msgId of msgIds) {
    try {
      await ctx.api.deleteMessage(chatId, msgId);
    } catch {
      // Message may already be deleted — ignore
    }
  }

  // Clear old list from DB
  clearList(chatId);
}

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
    await ctx.reply("No items found. Try again with /list");
    return;
  }

  // Delete previous list messages from chat before creating a new one
  await deleteOldListMessages(ctx, chatId);

  const listId = createList(chatId, items);
  logger.info("list", `chat:${chatId} created list #${listId} with ${items.length} items: [${items.join(", ")}]`);

  await ctx.reply(
    `Saved ${items.length} item${items.length > 1 ? "s" : ""}\\! Send /shop when you're ready to go shopping\\.`,
    { parse_mode: "MarkdownV2" },
  );
}
