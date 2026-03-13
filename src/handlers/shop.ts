import type { Context } from "grammy";
import { getActiveList, updateListHeaderMsgId, updateItemMsgId } from "../db.js";
import { renderHeaderText, renderItemText, renderItemKeyboard } from "../render.js";
import { logger } from "../logger.js";

export async function handleShopCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = getActiveList(chatId);
  if (!data || data.items.length === 0) {
    logger.debug("shop", `chat:${chatId} no active list`);
    await ctx.reply("No active shopping list\\. Use /list to create one\\.", {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const { list, items } = data;
  const doneCount = items.filter((i) => i.done).length;
  logger.info("shop", `chat:${chatId} displaying list #${list.id} (${items.length} items, ${doneCount} done)`);

  // Send header message
  const headerMsg = await ctx.reply(renderHeaderText(items), {
    parse_mode: "MarkdownV2",
  });
  updateListHeaderMsgId(list.id, headerMsg.message_id);
  logger.debug("shop", `chat:${chatId} header sent as msg:${headerMsg.message_id}`);

  // Send one message per item with an inline button
  for (const item of items) {
    try {
      const msg = await ctx.reply(renderItemText(item), {
        parse_mode: "MarkdownV2",
        reply_markup: renderItemKeyboard(item),
        disable_notification: true,
      });
      updateItemMsgId(item.id, msg.message_id);
      logger.debug("shop", `chat:${chatId} item #${item.id} "${item.name}" sent as msg:${msg.message_id}`);
    } catch (err) {
      logger.error("shop", `chat:${chatId} failed to send item #${item.id} "${item.name}"`, err);
    }
  }
}
