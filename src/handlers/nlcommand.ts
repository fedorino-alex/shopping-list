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
import type { ExtractedGroup, NLCommandStep } from "../extractor.js";
import { classifyAndExtract, resolveRemoveTargets } from "../extractor.js";
import type { BotState } from "../extractor.js";
import { isShoppingMode, coreStartShopping } from "./shop.js";
import { getWorkflow, buildStatusContent, pluralItems } from "./workflow.js";
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

  const steps = await classifyAndExtract(text, state);

  if (steps.length > 1) {
    await handleCompound(ctx, steps, state, workflow);
    return;
  }

  const cmd = steps[0];
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

/** Handle compound NL commands ("убери X и добавь Y", "замени X на Y"). */
async function handleCompound(
  ctx: Context,
  steps: NLCommandStep[],
  state: BotState,
  workflow: ReturnType<typeof getWorkflow>,
): Promise<void> {
  const chatId = ctx.chat!.id;
  const chatType = ctx.chat!.type;
  const isPrivate = chatType !== "group" && chatType !== "supergroup";

  let addedCount = 0;
  let dupCount = 0;
  const removedNames: string[] = [];
  let currentState = state;

  for (const step of steps) {
    if (step.intent === "add") {
      const r = await executeAddStep(chatId, step.groups, currentState);
      addedCount += r.addedCount;
      dupCount += r.dupCount;
      currentState = "NORMAL";
    } else if (step.intent === "remove") {
      if (currentState === "IDLE") continue; // nothing to remove yet
      const removed = await executeRemoveStep(chatId, step.query);
      removedNames.push(...removed.map((i) => renderItemName(i)));
    }
    // show / start_shopping / unknown: skip in compound
  }

  // Group: send one combined summary reply
  if (!isPrivate) {
    const parts: string[] = [];
    if (removedNames.length > 0) parts.push(`🗑 Удалено: ${removedNames.join(", ")}`);
    if (addedCount > 0) parts.push(`✅ Добавлено: ${pluralItems(addedCount)}`);
    if (dupCount > 0) parts.push(`${dupCount} уже в списке`);
    if (parts.length > 0) {
      await ctx.reply(parts.join(" · "), {
        reply_parameters: { message_id: ctx.message!.message_id },
      });
    }
  }

  // Single UI update at end
  const finalState = getBotState(chatId);
  if (finalState === "IDLE") {
    if (!isPrivate) {
      await deleteStatusMessage(ctx.api, chatId, chatType);
    } else {
      const s = renderIdleStatus();
      await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    }
  } else {
    const data = getActiveList(chatId);
    if (data) {
      const visible = getVisibleItems(data.list.id);
      const { text: statusText, keyboard } = buildStatusContent(finalState, visible);
      await editStatusMessage(ctx.api, chatId, statusText, keyboard);
    }
  }

  // Delete user message in private
  if (isPrivate && ctx.message) {
    try { await ctx.api.deleteMessage(chatId, ctx.message.message_id); } catch { /* ignore */ }
  }
}

async function executeAddStep(
  chatId: number,
  groups: ExtractedGroup[],
  state: BotState,
): Promise<{ addedCount: number; dupCount: number }> {
  if (state === "IDLE") {
    createList(chatId, groups);
    const total = groups.flatMap((g) => g.items).length;
    logger.info("nl", `chat:${chatId} compound auto-created list with ${total} item(s)`);
    return { addedCount: total, dupCount: 0 };
  }

  const data = getActiveList(chatId);
  if (!data) return { addedCount: 0, dupCount: 0 };

  const listId = data.list.id;
  const allCodes = groups.flatMap((g) => g.items.map((i) => i.code));
  const dupes = findDuplicateItems(listId, allCodes);
  const dupeSet = new Set(dupes.map((n) => n.toLowerCase().trim()));
  const filteredGroups = groups
    .map((g) => ({ group: g.group, items: g.items.filter((i) => !dupeSet.has(i.code.toLowerCase().trim())) }))
    .filter((g) => g.items.length > 0);

  if (filteredGroups.length === 0) return { addedCount: 0, dupCount: dupes.length };

  const added = addItemsToList(listId, chatId, filteredGroups);
  logger.info("nl", `chat:${chatId} compound added ${added.length} item(s), ${dupes.length} dup(s)`);
  return { addedCount: added.length, dupCount: dupes.length };
}

async function executeRemoveStep(
  chatId: number,
  query: string,
): Promise<{ id: number; code: string; details: string | null }[]> {
  const data = getActiveList(chatId);
  if (!data) return [];

  const visible = getVisibleItems(data.list.id);
  const targets = await resolveRemoveTargets(query, visible);
  for (const item of targets) {
    removeItem(item.id);
  }
  if (targets.length > 0) {
    logger.info("nl", `chat:${chatId} compound removed ${targets.length} item(s): [${targets.map((i) => i.code).join(", ")}]`);
  }
  return targets;
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


