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
    text: escapeMarkdown("No active list."),
    keyboard: new InlineKeyboard().text("New List", "action:new_list"),
  };
}

/** AWAITING_INPUT state: waiting for comma-separated items */
export function renderAwaitingStatus(): { text: string; keyboard?: undefined } {
  return {
    text: escapeMarkdown("Send me a comma-separated list of items to buy."),
  };
}

/** NORMAL state: list exists, not shopping */
export function renderNormalStatus(itemCount: number): { text: string; keyboard: InlineKeyboard } {
  return {
    text: escapeMarkdown(`Shopping List: ${itemCount} item${itemCount !== 1 ? "s" : ""}`),
    keyboard: new InlineKeyboard()
      .text("Start Shopping", "action:start_shopping")
      .text("Clear List", "action:clear_list"),
  };
}

/** SHOPPING state: header with done counter + control buttons */
export function renderShoppingStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const completeCount = items.filter((i) => i.complete).length;
  const total = items.length;
  return {
    text: escapeMarkdown(`Shopping List (${completeCount}/${total} done)`),
    keyboard: new InlineKeyboard()
      .text("Compact", "action:compact")
      .text("Clear List", "action:clear_list"),
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
  const label = item.complete ? "Undo" : "Done";
  return new InlineKeyboard().text(label, `toggle:${item.id}`);
}
