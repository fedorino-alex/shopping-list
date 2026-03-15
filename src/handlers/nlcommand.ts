import type { Context } from "grammy";
import {
  getActiveList,
  getVisibleItems,
  createList,
  addItemsToList,
  findDuplicateItems,
  removeItem,
  clearList,
} from "../db.js";
import type { ExtractedGroup } from "../extractor.js";
import { classifyAndExtract, resolveRemoveTargets } from "../extractor.js";
import type { BotState } from "../extractor.js";
import { isShoppingMode, coreStartShopping } from "./shop.js";
import { getWorkflow } from "./workflow.js";
import { renderIdleStatus, renderItemName } from "../render.js";
import { editStatusMessage, deleteStatusMessage } from "../status.js";
import { logger } from "../logger.js";

export { BotState };

/** Derives the current bot state from DB + in-memory sets. */
export function getBotState(chatId: number): BotState {
  const data = getActiveList(chatId);
  if (!data) return "IDLE";
  if (isShoppingMode(chatId)) return "SHOPPING";
  return "NORMAL";
}

/**
 * Central NL handler — called from both @mention and reply-to-status paths.
 * Classifies intent and dispatches to the appropriate sub-handler.
 */
export async function handleNLCommand(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getBotState(chatId);
  const workflow = getWorkflow(ctx.chat!.type);

  logger.debug("nl", `chat:${chatId} state=${state} text="${text.slice(0, 80)}"`);

  const cmd = await classifyAndExtract(text, state);

  switch (cmd.intent) {
    case "add":
      await handleNLAdd(ctx, cmd.groups, state, workflow);
      break;

    case "remove":
      await handleNLRemove(ctx, cmd.query, workflow);
      break;

    case "show":
      await handleNLShow(ctx, state, workflow);
      break;

    case "start_shopping":
      await handleNLStartShopping(ctx, state, workflow);
      break;

    case "unknown":
      await workflow.replyUnknown(ctx, state);
      break;
  }
}

async function handleNLAdd(
  ctx: Context,
  groups: ExtractedGroup[],
  state: BotState,
  workflow: ReturnType<typeof getWorkflow>,
): Promise<void> {
  const chatId = ctx.chat!.id;

  let listId: number;
  let added: ReturnType<typeof addItemsToList> = [];
  let dupCount = 0;

  if (state === "IDLE") {
    // Auto-create list with the extracted items
    listId = createList(chatId, groups);
    const allCodes = groups.flatMap((g) => g.items.map((i) => i.code));
    logger.info("nl", `chat:${chatId} auto-created list with ${allCodes.length} item(s): [${allCodes.join(", ")}]`);
  } else {
    const data = getActiveList(chatId);
    if (!data) return;
    listId = data.list.id;

    // Deduplicate against existing visible items
    const allCodes = groups.flatMap((g) => g.items.map((i) => i.code));
    const dupes = findDuplicateItems(listId, allCodes);
    dupCount = dupes.length;

    const dupeSet = new Set(dupes.map((n) => n.toLowerCase().trim()));
    const filteredGroups = groups
      .map((g) => ({ group: g.group, items: g.items.filter((i) => !dupeSet.has(i.code.toLowerCase().trim())) }))
      .filter((g) => g.items.length > 0);

    if (filteredGroups.length > 0) {
      added = addItemsToList(listId, chatId, filteredGroups);
      const addedCodes = added.map((i) => i.code);
      logger.info("nl", `chat:${chatId} added ${added.length} item(s): [${addedCodes.join(", ")}]${dupCount > 0 ? `, ${dupCount} duplicate(s) skipped` : ""}`);
    }
  }

  const totalAdded = state === "IDLE" ? groups.flatMap((g) => g.items).length : added.length;
  await workflow.afterAdd(ctx, state, listId, totalAdded, dupCount);
}

async function handleNLRemove(
  ctx: Context,
  query: string,
  workflow: ReturnType<typeof getWorkflow>,
): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getBotState(chatId);

  if (state !== "NORMAL") {
    const msg =
      state === "IDLE"
        ? "Нет активного списка 📝"
        : "🛒 Вы в режиме покупок — завершите покупки, чтобы управлять списком";
    await ctx.reply(msg, { reply_parameters: { message_id: ctx.message!.message_id } });
    return;
  }

  const data = getActiveList(chatId);
  if (!data) return;

  const visible = getVisibleItems(data.list.id);
  const targets = await resolveRemoveTargets(query, visible);

  if (targets.length === 0) {
    await ctx.reply("🤔 Не нашёл таких товаров в списке", {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  for (const item of targets) {
    removeItem(item.id);
  }
  logger.info("nl", `chat:${chatId} removed ${targets.length} item(s) via NL: [${targets.map((i) => i.code).join(", ")}]`);

  // If no visible items remain, clear the list and go to IDLE
  const remaining = getVisibleItems(data.list.id);
  if (remaining.length === 0) {
    clearList(chatId);
    const chatType = ctx.chat!.type;
    if (chatType === "group" || chatType === "supergroup") {
      const removedNames = targets.map((i) => renderItemName(i)).join(", ");
      await ctx.reply(`🗑 ${removedNames} — список теперь пуст`, {
        reply_parameters: { message_id: ctx.message!.message_id },
      });
      await deleteStatusMessage(ctx.api, chatId, chatType);
    } else {
      const status = renderIdleStatus();
      await editStatusMessage(ctx.api, chatId, status.text, status.keyboard);
    }
    return;
  }

  await workflow.afterRemove(ctx, data.list.id, targets);
}

async function handleNLShow(ctx: Context, state: BotState, workflow: ReturnType<typeof getWorkflow>): Promise<void> {
  const chatId = ctx.chat!.id;

  const data = getActiveList(chatId);
  if (!data) {
    await ctx.reply("Список пуст 📝", {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  await workflow.afterShow(ctx, state, data.list.id);
}

async function handleNLStartShopping(
  ctx: Context,
  state: BotState,
  workflow: ReturnType<typeof getWorkflow>,
): Promise<void> {
  const chatId = ctx.chat!.id;

  if (state === "IDLE") {
    await ctx.reply("Список пуст 📝", {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }
  if (state === "SHOPPING") {
    await ctx.reply("Уже в режиме покупок 🛒", {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  await coreStartShopping(chatId, ctx.api, ctx.chat!.type);
  await workflow.afterStartShopping(ctx);
}


