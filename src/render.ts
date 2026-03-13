import { InlineKeyboard } from "grammy";
import type { ItemRow } from "./db.js";

// MarkdownV2 requires escaping these characters in regular text
const SPECIAL_CHARS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdown(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$&");
}

// --- Status message renderers (one persistent message, edited per state) ---

/** IDLE state: no active list */
export function renderIdleStatus(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: escapeMarkdown("No active shopping list."),
    keyboard: new InlineKeyboard().text("📝 New List", "action:new_list"),
  };
}

/** AWAITING_INPUT state: waiting for comma-separated items */
export function renderAwaitingStatus(): { text: string; keyboard?: undefined } {
  return {
    text: escapeMarkdown("Send me a comma-separated list of items to buy."),
  };
}

/** NORMAL state: list exists, not shopping — shows all items then a summary line */
export function renderNormalStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const count = items.length;
  const lines = items.map((i) => escapeMarkdown(`• ${i.name}`));
  if (lines.length > 0) lines.push(""); // blank line before summary
  lines.push(escapeMarkdown(`🛒 ${count} item${count !== 1 ? "s" : ""}`));
  return {
    text: lines.join("\n"),
    keyboard: new InlineKeyboard()
      .text("🛍 Start Shopping", "action:start_shopping")
      .text("🗑 Clear List", "action:clear_list")
      .row()
      .text("✏️ Edit List", "action:edit_list"),
  };
}

/** SHOPPING state: header with done counter + control buttons */
export function renderShoppingStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const completeCount = items.filter((i) => i.complete).length;
  const total = items.length;
  return {
    text: escapeMarkdown(`🛍 Shopping (${completeCount}/${total} done)`),
    keyboard: new InlineKeyboard()
      .text("🧹 Compact", "action:compact")
      .text("✅ Finish", "action:finish_shopping")
      .row()
      .text("✏️ Edit List", "action:edit_list"),
  };
}

/** EDITING state: status header while editing the list */
export function renderEditingStatus(itemCount: number): { text: string; keyboard: InlineKeyboard } {
  return {
    text: escapeMarkdown(`✏️ Editing: ${itemCount} item${itemCount !== 1 ? "s" : ""}`),
    keyboard: new InlineKeyboard()
      .text("➕ Add Items", "action:add_items")
      .text("✅ Done", "action:done_editing"),
  };
}

/** AWAITING_ADD sub-state: waiting for user to send items to add */
export function renderAwaitingAddStatus(): { text: string } {
  return {
    text: escapeMarkdown("➕ Send items to add (comma-separated)."),
  };
}

// --- Item renderers ---

const ITEM_PAD_WIDTH = 25;

export function renderItemText(item: ItemRow): string {
  const padded = item.name.padEnd(ITEM_PAD_WIDTH);
  // Backtick content in MarkdownV2 needs only backtick and backslash escaped
  const codeText = padded.replace(/[`\\]/g, "\\$&");
  if (item.complete) {
    return `\u2705 \`${codeText}\``;
  }
  return `\`${codeText}\``;
}

export function renderItemKeyboard(item: ItemRow): InlineKeyboard {
  const label = item.complete ? "↩️ Undo" : "✅ Done";
  return new InlineKeyboard().text(label, `toggle:${item.id}`);
}

/** Keyboard shown on each item message while in EDITING state */
export function renderItemRemoveKeyboard(item: ItemRow): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Remove", `remove:${item.id}`);
}
