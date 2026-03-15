/**
 * ChatWorkflow: defines post-action UX behavior per chat type.
 *
 * PrivateWorkflow  — status message is the live list UI, updated after every
 *                    change; user messages deleted to keep chat clean; no
 *                    confirmation replies (the updated status IS the feedback).
 *
 * GroupWorkflow    — pinned message is the anchor; confirmation replies are
 *                    sent anchored to the user's message; status re-pinned on
 *                    "show" and on first-ever add.
 */

import type { Context } from "grammy";
import { getActiveList, getVisibleItems } from "../db.js";
import type { ItemRow } from "../db.js";
import { editStatusMessage, sendStatusMessage } from "../status.js";
import {
  renderNormalStatus,
  renderShoppingStatus,
  renderItemName,
} from "../render.js";
import type { BotState } from "../extractor.js";

// --- Types ---

export interface ChatWorkflow {
  /** After items added: refresh UI and optionally send confirmation. */
  afterAdd(
    ctx: Context,
    prevState: BotState,
    listId: number,
    totalAdded: number,
    dupCount: number,
  ): Promise<void>;

  /** After items removed: refresh UI and optionally send confirmation. */
  afterRemove(
    ctx: Context,
    listId: number,
    removed: Pick<ItemRow, "id" | "code" | "details">[],
  ): Promise<void>;

  /** After "show": refresh UI. */
  afterShow(ctx: Context, state: BotState, listId: number): Promise<void>;

  /** After start_shopping: send confirmation if needed (coreStartShopping already ran). */
  afterStartShopping(ctx: Context): Promise<void>;

  /** Reply for unrecognised intent. */
  replyUnknown(ctx: Context, state: BotState): Promise<void>;
}

// --- Shared helpers ---

export function buildStatusContent(
  state: BotState,
  visible: ItemRow[],
): { text: string; keyboard: import("grammy").InlineKeyboard } {
  if (state === "SHOPPING") return renderShoppingStatus(visible);
  return renderNormalStatus(visible);
}

export function pluralItems(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} товаров`;
  if (mod10 === 1) return `${count} товар`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} товара`;
  return `${count} товаров`;
}

function unknownReplyText(state: BotState): string {
  switch (state) {
    case "IDLE":
      return "📝 Напишите что купить, например: молоко, хлеб, сыр";
    case "SHOPPING":
      return "🛒 Вы в режиме покупок — отмечайте купленное кнопками под списком";
    default:
      return "🤔 Не понял. Напишите что добавить, например: молоко и хлеб";
  }
}

async function deleteUserMessage(ctx: Context): Promise<void> {
  const msgId = ctx.message?.message_id;
  if (!msgId) return;
  try {
    await ctx.api.deleteMessage(ctx.chat!.id, msgId);
  } catch {
    // Ignore if already gone
  }
}

// --- Private Chat Workflow ---
// Status message = live list. Updated after every change. User messages deleted.
// No confirmation replies — the updated status IS the feedback.

class PrivateWorkflow implements ChatWorkflow {
  async afterAdd(
    ctx: Context,
    prevState: BotState,
    listId: number,
    _totalAdded: number,
    _dupCount: number,
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const newState = prevState === "IDLE" ? "NORMAL" : prevState;
    const visible = getVisibleItems(listId);
    const s = buildStatusContent(newState, visible);
    if (prevState === "IDLE") {
      // No existing status — send a fresh one (no pin in private)
      await sendStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    } else {
      await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    }
    await deleteUserMessage(ctx);
  }

  async afterRemove(
    ctx: Context,
    listId: number,
    _removed: Pick<ItemRow, "id" | "code" | "details">[],
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const visible = getVisibleItems(listId);
    const s = renderNormalStatus(visible);
    await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    await deleteUserMessage(ctx);
  }

  async afterShow(ctx: Context, state: BotState, listId: number): Promise<void> {
    const chatId = ctx.chat!.id;
    const visible = getVisibleItems(listId);
    const s = buildStatusContent(state, visible);
    await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    // User message kept — it's the "покажи список" trigger; deleting feels wrong
  }

  async afterStartShopping(ctx: Context): Promise<void> {
    // coreStartShopping already called editStatusMessage to shopping state
    await deleteUserMessage(ctx);
  }

  async replyUnknown(ctx: Context, state: BotState): Promise<void> {
    await ctx.reply(unknownReplyText(state), {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }
}

// --- Group Chat Workflow ---
// Pinned message = the anchor. Confirmation replies sent after every action.
// Status re-pinned on "show" and on first-ever add (IDLE→NORMAL).

class GroupWorkflow implements ChatWorkflow {
  async afterAdd(
    ctx: Context,
    prevState: BotState,
    listId: number,
    totalAdded: number,
    dupCount: number,
  ): Promise<void> {
    const chatId = ctx.chat!.id;

    // Confirmation reply anchored to the user's message
    const parts: string[] = [];
    if (totalAdded > 0) parts.push(`✅ Добавлено: ${pluralItems(totalAdded)}`);
    if (dupCount > 0) parts.push(`${dupCount} уже в списке`);
    if (parts.length === 0) parts.push("Всё уже в списке");
    await ctx.reply(parts.join(" · "), {
      reply_parameters: { message_id: ctx.message!.message_id },
    });

    const newState = prevState === "IDLE" ? "NORMAL" : prevState;
    const visible = getVisibleItems(listId);
    const s = buildStatusContent(newState, visible);
    if (prevState === "IDLE") {
      // First add: send + pin initial status
      await sendStatusMessage(ctx.api, chatId, s.text, s.keyboard, ctx.chat!.type);
    } else {
      // Subsequent add: silently edit pinned status in place (no re-pin)
      await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    }
  }

  async afterRemove(
    ctx: Context,
    listId: number,
    removed: Pick<ItemRow, "id" | "code" | "details">[],
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const visible = getVisibleItems(listId);
    const s = renderNormalStatus(visible);
    await editStatusMessage(ctx.api, chatId, s.text, s.keyboard);
    const removedNames = removed.map((i) => renderItemName(i)).join(", ");
    await ctx.reply(`🗑 Удалено: ${removedNames}`, {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }

  async afterShow(ctx: Context, state: BotState, listId: number): Promise<void> {
    const chatId = ctx.chat!.id;
    const visible = getVisibleItems(listId);
    const s = buildStatusContent(state, visible);
    // Unpin old, send fresh at bottom of chat, re-pin
    await sendStatusMessage(ctx.api, chatId, s.text, s.keyboard, ctx.chat!.type);
  }

  async afterStartShopping(ctx: Context): Promise<void> {
    // coreStartShopping already sent + re-pinned the shopping status at the bottom
    await ctx.reply("🛒 Поехали!", {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }

  async replyUnknown(ctx: Context, state: BotState): Promise<void> {
    await ctx.reply(unknownReplyText(state), {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }
}

// --- Factory ---

const privateWorkflow = new PrivateWorkflow();
const groupWorkflow = new GroupWorkflow();

export function getWorkflow(chatType: string): ChatWorkflow {
  return chatType === "group" || chatType === "supergroup"
    ? groupWorkflow
    : privateWorkflow;
}
