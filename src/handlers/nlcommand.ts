import type { Context } from "grammy";
import {
  getActiveList,
  getVisibleItems,
  createList,
  addItemsToList,
  findVisibleItemByCode,
  updateItemDetails,
  removeItem,
  clearList,
} from "../db.js";
import type { ExtractedGroup, ExtractedItem, NLCommandStep } from "../extractor.js";
import { classifyAndExtract, resolveRemoveTargets } from "../extractor.js";
import type { BotState } from "../extractor.js";
import { isShoppingMode, coreStartShopping } from "./shop.js";
import { getWorkflow, buildStatusContent, pluralItems } from "./workflow.js";
import { renderIdleStatus, renderItemName } from "../render.js";
import { editStatusMessage, deleteStatusMessage } from "../status.js";
import { logger } from "../logger.js";
import { parseQty, addQty, subtractQty, formatQty } from "../quantity.js";
import type { ParsedQty } from "../quantity.js";

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

  logger.debug("nl", `chat:${chatId} state=${state} text="${text.slice(0, 120)}"`);

  // Log list state before NL operation
  const preData = getActiveList(chatId);
  if (preData) {
    const preItems = getVisibleItems(preData.list.id);
    logger.debug("nl", `chat:${chatId} list BEFORE (${preItems.length} items): [${preItems.map((i) => `${i.code}${i.details ? ` (${i.details})` : ""}`).join(", ")}]`);
  } else {
    logger.debug("nl", `chat:${chatId} list BEFORE: (none)`);
  }

  const steps = await classifyAndExtract(text, state);

  if (steps.length > 1) {
    await handleCompound(ctx, steps, state, workflow);
    return;
  }

  const cmd = steps[0];
  logger.debug("nl", `chat:${chatId} intent=${cmd.intent}`);
  switch (cmd.intent) {
    case "add":
      await handleNLAdd(ctx, cmd.groups, state, workflow);
      break;

    case "remove":
      await handleNLRemove(ctx, cmd.query, cmd.qty, workflow);
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

    case "rate_limited": {
      const rateLimitedReplies = [
        "🧠 Мой мозг сегодня закончился — слишком много думал. Попробуй через минутку!",
        "🪫 Разрядился. Иду на подзарядку, вернусь через минуту.",
        "😵‍💫 Слишком много списков на сегодня, голова кругом. Чуть позже, ладно?",
        "☕️ Ушёл пить кофе — думал слишком интенсивно. Загляни через минутку.",
        "🐢 Groq говорит «стоп» — думаю слишком быстро для них. Попробуй через минуту.",
        "💤 Перегрелся и ушёл в спячку. Буди через минуту.",
        "🤯 Перемыслил на сегодня. Дай мозгу остыть — минуту-другую.",
      ];
      const reply = rateLimitedReplies[Math.floor(Math.random() * rateLimitedReplies.length)];
      await ctx.reply(reply, {
        ...(ctx.message?.message_id
          ? { reply_parameters: { message_id: ctx.message.message_id } }
          : {}),
      });
      break;
    }
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
  let mergedCount = 0;
  let dupCount = 0;
  const removedNames: string[] = [];
  const updatedNames: string[] = [];
  let currentState = state;

  for (const step of steps) {
    if (step.intent === "add") {
      const r = await executeAddStep(chatId, step.groups, currentState);
      addedCount += r.addedCount;
      mergedCount += r.mergedCount;
      dupCount += r.dupCount;
      updatedNames.push(...r.mergedNames);
      currentState = "NORMAL";
    } else if (step.intent === "remove") {
      if (currentState === "IDLE") continue; // nothing to remove yet
      const removed = await executeRemoveStep(chatId, step.query, step.qty);
      removedNames.push(...removed.map((i) => renderItemName(i)));
    }
    // show / start_shopping / unknown: skip in compound
  }

  // Group: send one combined summary reply
  if (!isPrivate) {
    const parts: string[] = [];
    if (removedNames.length > 0) parts.push(`🗑 Удалено: ${removedNames.join(", ")}`);
    if (addedCount > 0) parts.push(`✅ Добавлено: ${pluralItems(addedCount)}`);
    if (mergedCount > 0) parts.push(`📝 Обновлено: ${updatedNames.join(", ")}`);
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
): Promise<{ addedCount: number; mergedCount: number; dupCount: number; mergedNames: string[] }> {
  if (state === "IDLE") {
    createList(chatId, groups);
    const total = groups.flatMap((g) => g.items).length;
    logger.info("nl", `chat:${chatId} compound auto-created list with ${total} item(s)`);
    return { addedCount: total, mergedCount: 0, dupCount: 0, mergedNames: [] };
  }

  const data = getActiveList(chatId);
  if (!data) return { addedCount: 0, mergedCount: 0, dupCount: 0, mergedNames: [] };

  const result = mergeOrInsertItems(data.list.id, chatId, groups);
  if (result.addedCount > 0 || result.mergedCount > 0) {
    logger.info("nl", `chat:${chatId} compound added ${result.addedCount}, merged ${result.mergedCount}, dup ${result.dupCount}`);
  }
  return result;
}

async function executeRemoveStep(
  chatId: number,
  query: string,
  qty?: ParsedQty,
): Promise<{ id: number; code: string; details: string | null }[]> {
  const data = getActiveList(chatId);
  if (!data) return [];

  const visible = getVisibleItems(data.list.id);
  const targets = await resolveRemoveTargets(query, visible);

  const removedDisplay: { id: number; code: string; details: string | null }[] = [];
  for (const item of targets) {
    const result = applyPartialRemove(item, qty);
    removedDisplay.push({ id: item.id, code: item.code, details: result.displayDetails });
  }

  if (targets.length > 0) {
    logger.info("nl", `chat:${chatId} compound removed/updated ${targets.length} item(s): [${targets.map((i) => i.code).join(", ")}]`);
  }
  return removedDisplay;
}

/**
 * Merge-or-insert logic: for each incoming item, check if it already exists.
 * If it does and quantities are compatible, merge (add quantities).
 * Otherwise insert as new or skip as duplicate.
 */
function mergeOrInsertItems(
  listId: number,
  chatId: number,
  groups: ExtractedGroup[],
): { addedCount: number; mergedCount: number; dupCount: number; mergedNames: string[] } {
  let addedCount = 0;
  let mergedCount = 0;
  let dupCount = 0;
  const mergedNames: string[] = [];
  const toInsert: { group: string; items: ExtractedItem[] }[] = [];

  for (const g of groups) {
    const newItems: ExtractedItem[] = [];
    for (const item of g.items) {
      const existing = findVisibleItemByCode(listId, item.code);
      if (!existing) {
        logger.debug("nl", `chat:${chatId} item "${item.code}": no match → insert`);
        newItems.push(item);
        continue;
      }
      logger.debug("nl", `chat:${chatId} item "${item.code}" matched existing "${existing.code}" (${existing.details ?? "no details"})`);

      // Existing item found — try to merge quantities
      const incomingQty = item.qty ?? parseQty(item.details);
      const existingQty = parseQty(existing.details);

      if (incomingQty && existingQty) {
        // Both have quantities — try to add
        const merged = addQty(existingQty, incomingQty);
        if (merged) {
          const newDetails = formatQty(merged);
          updateItemDetails(existing.id, newDetails);
          mergedCount++;
          mergedNames.push(`${existing.code} → ${newDetails}`);
          logger.info("nl", `chat:${chatId} merged ${existing.code}: ${existing.details} + ${item.details ?? formatQty(incomingQty)} = ${newDetails}`);
        } else {
          // Incompatible units — append to details (e.g. "2 пачки" + "1кг" → "2 пачки, 1кг")
          const incomingDetails = item.details ?? formatQty(incomingQty);
          const newDetails = `${existing.details}, ${incomingDetails}`;
          updateItemDetails(existing.id, newDetails);
          mergedCount++;
          mergedNames.push(`${existing.code} → ${newDetails}`);
          logger.info("nl", `chat:${chatId} merged ${existing.code}: appended incompatible ${existing.details} + ${incomingDetails} = ${newDetails}`);
        }
      } else if (incomingQty && !existingQty) {
        if (incomingQty.unit === "шт") {
          // Incoming is шт → assume existing was 1 шт, add
          const assumed: ParsedQty = { value: 1, unit: "шт" };
          const merged = addQty(assumed, incomingQty)!;
          const newDetails = formatQty(merged);
          updateItemDetails(existing.id, newDetails);
          mergedCount++;
          mergedNames.push(`${existing.code} → ${newDetails}`);
          logger.info("nl", `chat:${chatId} merged ${existing.code}: (assumed 1 шт) + ${formatQty(incomingQty)} = ${newDetails}`);
        } else {
          // Incoming is non-шт (кг, л, etc.) → overwrite with more specific info
          const newDetails = item.details ?? formatQty(incomingQty);
          updateItemDetails(existing.id, newDetails);
          mergedCount++;
          mergedNames.push(`${existing.code} → ${newDetails}`);
          logger.info("nl", `chat:${chatId} merged ${existing.code}: overwrite bare → ${newDetails}`);
        }
      } else if (!incomingQty && existingQty) {
        // Incoming has no qty → assume adding 1 of existing's unit
        const extra: ParsedQty = { value: 1, unit: existingQty.unit };
        const merged = addQty(existingQty, extra);
        if (merged) {
          const newDetails = formatQty(merged);
          updateItemDetails(existing.id, newDetails);
          mergedCount++;
          mergedNames.push(`${existing.code} → ${newDetails}`);
          logger.info("nl", `chat:${chatId} merged ${existing.code}: ${existing.details} + 1 = ${newDetails}`);
        } else {
          newItems.push(item);
        }
      } else {
        // Neither has qty — pure duplicate, skip
        dupCount++;
      }
    }
    if (newItems.length > 0) {
      toInsert.push({ group: g.group, items: newItems });
    }
  }

  if (toInsert.length > 0) {
    const added = addItemsToList(listId, chatId, toInsert);
    addedCount = added.length;
  }

  return { addedCount, mergedCount, dupCount, mergedNames };
}

/**
 * Apply partial removal: if qty is specified, subtract from item's quantity.
 * If result > 0, update the item's details. If result <= 0 or no qty, remove entirely.
 * Returns display details for feedback.
 */
function applyPartialRemove(
  item: { id: number; code: string; details: string | null },
  qty?: ParsedQty,
): { removed: boolean; displayDetails: string | null } {
  if (!qty) {
    // No quantity specified — remove entire item
    removeItem(item.id);
    return { removed: true, displayDetails: item.details };
  }

  const existingQty = parseQty(item.details);
  if (!existingQty) {
    // Item has no parseable quantity — remove entirely
    removeItem(item.id);
    return { removed: true, displayDetails: item.details };
  }

  const result = subtractQty(existingQty, qty);
  if (!result) {
    // Result <= 0 or incompatible units — remove entirely
    removeItem(item.id);
    return { removed: true, displayDetails: item.details };
  }

  // Partial removal — update details
  const newDetails = formatQty(result);
  updateItemDetails(item.id, newDetails);
  logger.info("nl", `partial remove ${item.code}: ${item.details} - ${formatQty(qty)} = ${newDetails}`);
  return { removed: false, displayDetails: newDetails };
}

async function handleNLAdd(
  ctx: Context,
  groups: ExtractedGroup[],
  state: BotState,
  workflow: ReturnType<typeof getWorkflow>,
): Promise<void> {
  const chatId = ctx.chat!.id;

  let listId: number;
  let totalAdded = 0;
  let mergedCount = 0;
  let dupCount = 0;

  if (state === "IDLE") {
    // Auto-create list with the extracted items
    listId = createList(chatId, groups);
    totalAdded = groups.flatMap((g) => g.items).length;
    logger.info("nl", `chat:${chatId} auto-created list with ${totalAdded} item(s)`);
  } else {
    const data = getActiveList(chatId);
    if (!data) return;
    listId = data.list.id;

    const result = mergeOrInsertItems(listId, chatId, groups);
    totalAdded = result.addedCount;
    mergedCount = result.mergedCount;
    dupCount = result.dupCount;

    if (totalAdded > 0 || mergedCount > 0) {
      logger.info("nl", `chat:${chatId} add: ${totalAdded} new, ${mergedCount} merged, ${dupCount} dup(s)`);
    }
  }

  // Log list state after add
  const postAddItems = getVisibleItems(listId);
  logger.debug("nl", `chat:${chatId} list AFTER add (${postAddItems.length} items): [${postAddItems.map((i) => `${i.code}${i.details ? ` (${i.details})` : ""}`).join(", ")}]`);

  await workflow.afterAdd(ctx, state, listId, totalAdded + mergedCount, dupCount);
}

async function handleNLRemove(
  ctx: Context,
  query: string,
  qty: ParsedQty | undefined,
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
    applyPartialRemove(item, qty);
  }
  logger.info("nl", `chat:${chatId} removed/updated ${targets.length} item(s) via NL: [${targets.map((i) => i.code).join(", ")}]`);

  // Log list state after remove
  const postRemoveItems = getVisibleItems(data.list.id);
  logger.debug("nl", `chat:${chatId} list AFTER remove (${postRemoveItems.length} items): [${postRemoveItems.map((i) => `${i.code}${i.details ? ` (${i.details})` : ""}`).join(", ")}]`);

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


