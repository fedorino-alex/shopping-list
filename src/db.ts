import Database from "better-sqlite3";
import path from "node:path";
import type { ExtractedItem } from "./extractor.js";

const dbPath = process.env.DB_PATH ??
  path.join(process.cwd(), "..", "database", "shopping-list.db");

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Schema migration ---

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    chat_id        INTEGER PRIMARY KEY,
    status_msg_id  INTEGER           -- Telegram message_id of the persistent control message
  );

  CREATE TABLE IF NOT EXISTS lists (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id        INTEGER NOT NULL,
    deleted        INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id     INTEGER NOT NULL REFERENCES lists(id),
    chat_id     INTEGER NOT NULL,
    message_id  INTEGER,
    code        TEXT NOT NULL,
    details     TEXT,
    "group"     TEXT NOT NULL DEFAULT '',
    complete    INTEGER DEFAULT 0,
    hidden      INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate items table: replace name→code, add details (one-time migration for older DBs)
{
  const itemCols = (db.pragma('table_info(items)') as { name: string }[]).map((r) => r.name);
  if (!itemCols.includes('code')) {
    const hasGroup = itemCols.includes('group');
    const groupCols = hasGroup ? ', "group"' : '';
    db.exec(`
      ALTER TABLE items RENAME TO items_old;
      CREATE TABLE items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id     INTEGER NOT NULL REFERENCES lists(id),
        chat_id     INTEGER NOT NULL,
        message_id  INTEGER,
        code        TEXT NOT NULL,
        details     TEXT,
        "group"     TEXT NOT NULL DEFAULT '',
        complete    INTEGER DEFAULT 0,
        hidden      INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO items (id, list_id, chat_id, message_id, code${groupCols}, complete, hidden, created_at)
      SELECT id, list_id, chat_id, message_id, name${groupCols}, complete, hidden, created_at FROM items_old;
      DROP TABLE items_old;
    `);
  }
}

// --- Types ---

export interface ChatRow {
  chat_id: number;
  status_msg_id: number | null;
}

export interface ListRow {
  id: number;
  chat_id: number;
  deleted: number;
  created_at: string;
}

export interface ItemRow {
  id: number;
  list_id: number;
  chat_id: number;
  message_id: number | null;
  code: string;
  details: string | null;
  group: string;
  complete: number;
  hidden: number;
  created_at: string;
}

export interface ClearResult {
  count: number;
  itemMsgIds: number[];
}

export interface CompactResult {
  hiddenCount: number;
  allComplete: boolean;
  deletedMsgIds: number[];  // group messages where all items are done — delete the Telegram message
  updatedGroups: { msgId: number; groupName: string }[]; // groups with remaining items — re-render
}

// --- Prepared statements ---

const stmtUpsertChat = db.prepare(
  `INSERT INTO chats (chat_id) VALUES (?)
   ON CONFLICT(chat_id) DO NOTHING`
);

const stmtGetChat = db.prepare(
  `SELECT * FROM chats WHERE chat_id = ?`
);

const stmtUpdateStatusMsgId = db.prepare(
  `UPDATE chats SET status_msg_id = ? WHERE chat_id = ?`
);

const stmtInsertList = db.prepare(
  `INSERT INTO lists (chat_id) VALUES (?)`
);

const stmtInsertItem = db.prepare(
  `INSERT INTO items (list_id, chat_id, code, details, "group") VALUES (?, ?, ?, ?, ?)`
);

const stmtGetActiveList = db.prepare(
  `SELECT * FROM lists WHERE chat_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1`
);

const stmtGetItems = db.prepare(
  `SELECT * FROM items WHERE list_id = ? ORDER BY id ASC`
);

const stmtGetVisibleItems = db.prepare(
  `SELECT * FROM items WHERE list_id = ? AND hidden = 0 ORDER BY id ASC`
);

const stmtSoftDeleteItems = db.prepare(
  `UPDATE items SET hidden = 1 WHERE list_id = ?`
);

const stmtSoftDeleteList = db.prepare(
  `UPDATE lists SET deleted = 1 WHERE id = ?`
);

const stmtHideCompletedItems = db.prepare(
  `UPDATE items SET hidden = 1 WHERE list_id = ? AND complete = 1 AND hidden = 0`
);

const stmtGetCompletedVisibleItems = db.prepare(
  `SELECT * FROM items WHERE list_id = ? AND complete = 1 AND hidden = 0 ORDER BY id ASC`
);

const stmtGetItemsByGroup = db.prepare(
  `SELECT * FROM items WHERE list_id = ? AND "group" = ? AND hidden = 0 ORDER BY id ASC`
);

const stmtUpdateItemMsgId = db.prepare(
  `UPDATE items SET message_id = ? WHERE id = ?`
);

const stmtToggleItem = db.prepare(
  `UPDATE items SET complete = CASE WHEN complete = 0 THEN 1 ELSE 0 END WHERE id = ?`
);

const stmtGetItem = db.prepare(
  `SELECT * FROM items WHERE id = ?`
);

const stmtHideItem = db.prepare(
  `UPDATE items SET hidden = 1 WHERE id = ?`
);

// --- Public API: Chats ---

export function getChat(chatId: number): ChatRow {
  stmtUpsertChat.run(chatId);
  return stmtGetChat.get(chatId) as ChatRow;
}

export function updateStatusMsgId(chatId: number, msgId: number): void {
  stmtUpsertChat.run(chatId);
  stmtUpdateStatusMsgId.run(msgId, chatId);
}

/** Clears the stored status_msg_id after the status message has been deleted. */
export function clearStatusMsgId(chatId: number): void {
  stmtUpsertChat.run(chatId);
  stmtUpdateStatusMsgId.run(null, chatId);
}

/** Returns the stored status_msg_id for a chat, or null if not set / chat unknown. */
export function getStatusMsgId(chatId: number): number | null {
  const row = stmtGetChat.get(chatId) as ChatRow | undefined;
  return row?.status_msg_id ?? null;
}

// --- Public API: Lists ---

export function createList(chatId: number, groups: { group: string; items: ExtractedItem[] }[]): number {
  const result = stmtInsertList.run(chatId);
  const listId = result.lastInsertRowid as number;

  const insertMany = db.transaction((gs: { group: string; items: ExtractedItem[] }[]) => {
    for (const g of gs) {
      for (const item of g.items) {
        stmtInsertItem.run(listId, chatId, item.code.trim(), item.details?.trim() ?? null, g.group);
      }
    }
  });

  insertMany(groups);
  return listId;
}

export function getActiveList(chatId: number): { list: ListRow; items: ItemRow[] } | null {
  const list = stmtGetActiveList.get(chatId) as ListRow | undefined;
  if (!list) return null;

  const items = stmtGetItems.all(list.id) as ItemRow[];
  return { list, items };
}

export function getVisibleItems(listId: number): ItemRow[] {
  return stmtGetVisibleItems.all(listId) as ItemRow[];
}

/**
 * Soft-delete: marks list as deleted and all its items as hidden.
 * Returns item message IDs so the caller can delete Telegram messages.
 */
export function clearList(chatId: number): ClearResult {
  const list = stmtGetActiveList.get(chatId) as ListRow | undefined;
  if (!list) return { count: 0, itemMsgIds: [] };

  const items = stmtGetItems.all(list.id) as ItemRow[];
  const itemMsgIds = items
    .filter((i) => !i.hidden && i.message_id !== null)
    .map((i) => i.message_id as number);

  stmtSoftDeleteItems.run(list.id);
  stmtSoftDeleteList.run(list.id);

  return { count: items.length, itemMsgIds };
}

/**
 * Hides completed visible items (sets hidden = 1).
 * Returns per-group results so the caller can delete or re-render each group's Telegram message.
 */
export function compactList(chatId: number): CompactResult | null {
  const list = stmtGetActiveList.get(chatId) as ListRow | undefined;
  if (!list) return null;

  const completedItems = stmtGetCompletedVisibleItems.all(list.id) as ItemRow[];
  if (completedItems.length === 0) {
    const visibleAfter = stmtGetVisibleItems.all(list.id) as ItemRow[];
    return { hiddenCount: 0, allComplete: visibleAfter.length === 0, deletedMsgIds: [], updatedGroups: [] };
  }

  stmtHideCompletedItems.run(list.id);

  const visibleAfter = stmtGetVisibleItems.all(list.id) as ItemRow[];
  const allComplete = visibleAfter.length === 0;

  // Build a set of unique group message_ids that had completed items
  const completedGroupMsgIds = new Map<number, string>(); // msgId → groupName
  for (const item of completedItems) {
    if (item.message_id !== null) {
      completedGroupMsgIds.set(item.message_id, item.group || "Разное");
    }
  }

  // For each affected group message, decide: delete (no remaining items) or update (some remain)
  const visibleAfterByMsgId = new Set(
    visibleAfter.filter((i) => i.message_id !== null).map((i) => i.message_id as number)
  );

  const deletedMsgIds: number[] = [];
  const updatedGroups: { msgId: number; groupName: string }[] = [];

  for (const [msgId, groupName] of completedGroupMsgIds) {
    if (visibleAfterByMsgId.has(msgId)) {
      updatedGroups.push({ msgId, groupName });
    } else {
      deletedMsgIds.push(msgId);
    }
  }

  return { hiddenCount: completedItems.length, allComplete, deletedMsgIds, updatedGroups };
}

// --- Public API: Items ---

export function updateItemMsgId(itemId: number, msgId: number): void {
  stmtUpdateItemMsgId.run(msgId, itemId);
}

/** All non-hidden items for a given group in a list, ordered by id. */
export function getItemsByGroup(listId: number, groupName: string): ItemRow[] {
  return stmtGetItemsByGroup.all(listId, groupName) as ItemRow[];
}

export function toggleItem(itemId: number): ItemRow | null {
  stmtToggleItem.run(itemId);
  return stmtGetItem.get(itemId) as ItemRow | null;
}

export function getItem(itemId: number): ItemRow | null {
  return stmtGetItem.get(itemId) as ItemRow | null;
}

/**
 * Soft-delete a single item (sets hidden = 1).
 * Returns the item row (with its message_id) so the caller can delete the Telegram message,
 * or null if the item does not exist.
 */
export function removeItem(itemId: number): ItemRow | null {
  const item = stmtGetItem.get(itemId) as ItemRow | null;
  if (!item) return null;
  stmtHideItem.run(itemId);
  return item;
}

/**
 * Returns the subset of `codes` that already exist as visible items in the list.
 * Comparison is case-insensitive and trimmed.
 */
export function findDuplicateItems(listId: number, codes: string[]): string[] {
  const visible = stmtGetVisibleItems.all(listId) as ItemRow[];
  const existingLower = new Set(visible.map((i) => i.code.toLowerCase().trim()));
  return codes.filter((c) => existingLower.has(c.toLowerCase().trim()));
}

/**
 * Append new items to an existing list.
 * Returns the newly created ItemRow objects (no message_id yet).
 */
export function addItemsToList(listId: number, chatId: number, groups: { group: string; items: ExtractedItem[] }[]): ItemRow[] {
  const newItems: ItemRow[] = [];
  const insertMany = db.transaction((gs: { group: string; items: ExtractedItem[] }[]) => {
    for (const g of gs) {
      for (const item of g.items) {
        const result = stmtInsertItem.run(listId, chatId, item.code.trim(), item.details?.trim() ?? null, g.group);
        const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(result.lastInsertRowid) as ItemRow;
        newItems.push(row);
      }
    }
  });
  insertMany(groups);
  return newItems;
}
