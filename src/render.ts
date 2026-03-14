import { InlineKeyboard } from "grammy";
import type { ItemRow } from "./db.js";

// MarkdownV2 requires escaping these characters in regular text
const SPECIAL_CHARS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdown(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$&");
}

// --- Russian plural helper ---

function pluralItems(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} товаров`;
  if (mod10 === 1) return `${count} товар`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} товара`;
  return `${count} товаров`;
}

// --- Status message renderers (one persistent message, edited per state) ---

/** IDLE state: no active list */
export function renderIdleStatus(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: escapeMarkdown("Список покупок пуст."),
    keyboard: new InlineKeyboard().text("📝 Новый список", "action:new_list"),
  };
}

/** AWAITING_INPUT state: waiting for free-form input */
export function renderAwaitingStatus(): { text: string; keyboard?: undefined } {
  return {
    text: escapeMarkdown("Отправьте список покупок — можно в любой форме: перечислением, рецептом, текстом."),
  };
}

/** NORMAL state: list exists, not shopping — shows all items then a summary line */
export function renderNormalStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const lines = items.map((i) => escapeMarkdown(`• ${i.name}`));
  if (lines.length > 0) lines.push(""); // blank line before summary
  lines.push(escapeMarkdown(`🛒 ${pluralItems(items.length)}`));
  return {
    text: lines.join("\n"),
    keyboard: new InlineKeyboard()
      .text("🛍 Начать покупки", "action:start_shopping")
      .text("🗑 Очистить", "action:clear_list")
      .row()
      .text("✏️ Изменить список", "action:edit_list"),
  };
}

/** SHOPPING state: header with done counter + control buttons */
export function renderShoppingStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const completeCount = items.filter((i) => i.complete).length;
  const total = items.length;
  return {
    text: escapeMarkdown(`🛍 Покупки (${completeCount}/${total} куплено)`),
    keyboard: new InlineKeyboard()
      .text("🧹 Скрыть купленное", "action:compact")
      .text("🏁 Завершить", "action:finish_shopping"),
  };
}

/** EDITING state: status header while editing the list */
export function renderEditingStatus(itemCount: number): { text: string; keyboard: InlineKeyboard } {
  return {
    text: escapeMarkdown(`✏️ Редактирование: ${pluralItems(itemCount)}`),
    keyboard: new InlineKeyboard()
      .text("➕ Добавить", "action:add_items")
      .text("💾 Готово", "action:done_editing"),
  };
}

/** AWAITING_ADD sub-state: waiting for user to send items to add */
export function renderAwaitingAddStatus(): { text: string } {
  return {
    text: escapeMarkdown("➕ Отправьте товары для добавления."),
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
  const label = item.complete ? "↩️ Вернуть" : "🪙 Куплено";
  return new InlineKeyboard().text(label, `toggle:${item.id}`);
}

/** Keyboard shown on each item message while in EDITING state */
export function renderItemRemoveKeyboard(item: ItemRow): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Удалить", `remove:${item.id}`);
}
