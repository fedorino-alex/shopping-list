import { InlineKeyboard } from "grammy";
import type { ItemRow } from "./db.js";

// MarkdownV2 requires escaping these characters in regular text
const SPECIAL_CHARS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdown(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$&");
}

export function renderHeaderText(items: ItemRow[]): string {
  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  return escapeMarkdown(`Shopping List (${doneCount}/${total} done)`);
}

export function renderItemText(item: ItemRow): string {
  const escaped = escapeMarkdown(item.name);
  return item.done ? `~${escaped}~` : escaped;
}

export function renderItemKeyboard(item: ItemRow): InlineKeyboard {
  const label = item.done ? "Undo" : "Done";
  return new InlineKeyboard().text(label, `toggle:${item.id}`);
}
