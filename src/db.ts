import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "shopping-list.db");

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
    name        TEXT NOT NULL,
    complete    INTEGER DEFAULT 0,
    hidden      INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

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
  name: string;
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
  hiddenMsgIds: number[];
  allComplete: boolean;
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
  `INSERT INTO items (list_id, chat_id, name) VALUES (?, ?, ?)`
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

// --- Public API: Lists ---

export function createList(chatId: number, itemNames: string[]): number {
  const result = stmtInsertList.run(chatId);
  const listId = result.lastInsertRowid as number;

  const insertMany = db.transaction((names: string[]) => {
    for (const name of names) {
      stmtInsertItem.run(listId, chatId, name.trim());
    }
  });

  insertMany(itemNames);
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
 * Returns their message IDs for deletion from chat, and whether all items are now complete.
 */
export function compactList(chatId: number): CompactResult | null {
  const list = stmtGetActiveList.get(chatId) as ListRow | undefined;
  if (!list) return null;

  const completedItems = stmtGetCompletedVisibleItems.all(list.id) as ItemRow[];
  const hiddenMsgIds = completedItems
    .map((i) => i.message_id)
    .filter((id): id is number => id !== null);

  stmtHideCompletedItems.run(list.id);

  const visibleAfter = stmtGetVisibleItems.all(list.id) as ItemRow[];
  const allComplete = visibleAfter.length === 0;

  return {
    hiddenCount: completedItems.length,
    hiddenMsgIds,
    allComplete,
  };
}

// --- Public API: Items ---

export function updateItemMsgId(itemId: number, msgId: number): void {
  stmtUpdateItemMsgId.run(msgId, itemId);
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
 * Append new items to an existing list.
 * Returns the newly created ItemRow objects (no message_id yet).
 */
export function addItemsToList(listId: number, chatId: number, names: string[]): ItemRow[] {
  const newItems: ItemRow[] = [];
  const insertMany = db.transaction((ns: string[]) => {
    for (const name of ns) {
      const result = stmtInsertItem.run(listId, chatId, name.trim());
      const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(result.lastInsertRowid) as ItemRow;
      newItems.push(item);
    }
  });
  insertMany(names);
  return newItems;
}
