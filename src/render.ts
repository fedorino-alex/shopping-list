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

function pluralGroups(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} отделах`;
  if (mod10 === 1) return `${count} отделе`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} отделах`;
  return `${count} отделах`;
}

const GROUP_EMOJI: Record<string, string> = {
  "Хлеб и хлебобулочные изделия": "🍞",
  "Фрукты, овощи и зелень": "🥦",
  "Сухофрукты и орехи": "🥜",
  "Замороженные продукты": "🧊",
  "Мясо и птица": "🥩",
  "Рыба и морепродукты": "🐟",
  "Сыры": "🧀",
  "Колбасные изделия": "🌭",
  "Готовые блюда и кулинария": "🍱",
  "Молоко, молочные продукты и яйца": "🥛",
  "Растительные продукты": "🌱",
  "Кухни мира": "🌍",
  "Напитки и соки": "🧃",
  "Сладости": "🍫",
  "Солёные закуски": "🍿",
  "Консервы и заготовки": "🥫",
  "Соусы, приправы и масла": "🫙",
  "Крупы и сыпучие продукты": "🌾",
  "Товары для выпечки": "🧁",
  "Кофе, чай и какао": "☕",
  "Алкоголь": "🍷",
  "Бытовая химия и чистящие средства": "🧹",
  "Гигиена и косметика": "🧴",
  "Товары для детей и мам": "👶",
  "Игрушки": "🧸",
  "Товары для животных": "🐾",
  "Канцелярские и школьные товары": "✏️",
  "Товары для дома": "🏠",
  "Инструменты и ремонт": "🔧",
  "Сад и огород": "🌿",
  "Электроника и мультимедиа": "🔌",
  "Спорт и отдых": "⚽",
  "Автотовары": "🚗",
  "Разное": "📦",
};

// --- Item name helper ---

/** Canonical display name: code plus optional details. */
export function renderItemName(item: { code: string; details: string | null | undefined }): string {
  return item.details ? `${item.code}, ${item.details}` : item.code;
}

// --- Status message renderers (one persistent message, edited per state) ---

/** IDLE state: no active list */
export function renderIdleStatus(): { text: string; keyboard?: InlineKeyboard } {
  return {
    text: escapeMarkdown("Список покупок пуст. Напишите что купить, чтобы начать новый список."),
  };
}

/** NORMAL state: list exists, not shopping — shows items grouped by department */
export function renderNormalStatus(items: ItemRow[]): { text: string; keyboard: InlineKeyboard } {
  const lines: string[] = [];

  if (items.length === 0) {
    lines.push(escapeMarkdown("🛒 Список покупок пуст."));
  } else {
    // Group items by their department, preserving insertion order of first appearance
    const groupMap = new Map<string, ItemRow[]>();
    for (const item of items) {
      const key = item.group || "Разное";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }

    for (const [groupName, groupItems] of groupMap) {
      const emoji = GROUP_EMOJI[groupName] ?? "📦";
      lines.push(escapeMarkdown(`${emoji} ${groupName} — ${pluralItems(groupItems.length)}`));
      for (const item of groupItems) {
        lines.push(escapeMarkdown(`  • ${renderItemName(item)}`));
      }
      lines.push(""); // blank line between groups
    }

    // Remove trailing blank line
    if (lines[lines.length - 1] === "") lines.pop();

    lines.push("");
    lines.push(escapeMarkdown(`━━━━━━━━━━━━━━`));
    lines.push(escapeMarkdown(`Итого: ${pluralItems(items.length)} в ${pluralGroups(groupMap.size)}`));
  }

  return {
    text: lines.join("\n"),
    keyboard: new InlineKeyboard()
      .text("🛍 Начать покупки", "action:start_shopping")
      .text("🗑 Очистить", "action:clear_list"),
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

// --- Item renderers ---

export function renderItemKeyboard(item: ItemRow): InlineKeyboard {
  const label = item.complete ? "↩️ Вернуть" : "🪙 Куплено";
  return new InlineKeyboard().text(label, `toggle:${item.id}`);
}

/**
 * Plain-text summary of the shopping list, grouped by department with emoji headers.
 * No MarkdownV2 — safe to send as a regular chat reply.
 */
export function renderListSummary(items: ItemRow[]): string {
  if (items.length === 0) return "Список пуст 📝";

  const groupMap = new Map<string, ItemRow[]>();
  for (const item of items) {
    const key = item.group || "Разное";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }

  const lines: string[] = [];
  for (const [groupName, groupItems] of groupMap) {
    const emoji = GROUP_EMOJI[groupName] ?? "📦";
    lines.push(`${emoji} ${groupName}`);
    for (const item of groupItems) {
      const prefix = item.complete ? "✅" : "•";
      lines.push(`  ${prefix} ${renderItemName(item)}`);
    }
  }
  return lines.join("\n");
}

// --- Group message renderer (SHOPPING mode) ---

const MAX_BUTTON_LABEL = 32;

/**
 * One Telegram message per department group in SHOPPING mode.
 * Shows active items as a bulleted list, completed items with strikethrough.
 * Each item has its own toggle button on a separate row.
 */
export function renderGroupMessage(
  groupName: string,
  items: ItemRow[]
): { text: string; keyboard: InlineKeyboard } {
  const emoji = GROUP_EMOJI[groupName] ?? "📦";
  const lines: string[] = [];

  lines.push(`${emoji} *${escapeMarkdown(groupName)}*`);
  for (const item of items) {
    if (item.complete) {
      lines.push(`✅ ~${escapeMarkdown(renderItemName(item))}~`);
    } else {
      lines.push(escapeMarkdown(`• ${renderItemName(item)}`));
    }
  }

  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const label = item.complete
      ? `↩️ ${item.code}`.slice(0, MAX_BUTTON_LABEL)
      : `🪙 ${item.code}`.slice(0, MAX_BUTTON_LABEL);
    keyboard.text(label, `toggle:${item.id}`).row();
  }

  return { text: lines.join("\n"), keyboard };
}
