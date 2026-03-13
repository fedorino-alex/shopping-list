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
  CREATE TABLE IF NOT EXISTS lists (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id        INTEGER NOT NULL,
    header_msg_id  INTEGER,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id     INTEGER NOT NULL REFERENCES lists(id),
    chat_id     INTEGER NOT NULL,
    message_id  INTEGER,
    name        TEXT NOT NULL,
    done        INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// --- Types ---

export interface ListRow {
  id: number;
  chat_id: number;
  header_msg_id: number | null;
  created_at: string;
}

export interface ItemRow {
  id: number;
  list_id: number;
  chat_id: number;
  message_id: number | null;
  name: string;
  done: number;
  created_at: string;
}

// --- Prepared statements ---

const stmtInsertList = db.prepare(
  `INSERT INTO lists (chat_id) VALUES (?)`
);

const stmtInsertItem = db.prepare(
  `INSERT INTO items (list_id, chat_id, name) VALUES (?, ?, ?)`
);

const stmtGetActiveList = db.prepare(
  `SELECT * FROM lists WHERE chat_id = ? ORDER BY id DESC LIMIT 1`
);

const stmtGetItems = db.prepare(
  `SELECT * FROM items WHERE list_id = ? ORDER BY id ASC`
);

const stmtDeleteItems = db.prepare(
  `DELETE FROM items WHERE list_id = ?`
);

const stmtDeleteList = db.prepare(
  `DELETE FROM lists WHERE id = ?`
);

const stmtUpdateHeaderMsgId = db.prepare(
  `UPDATE lists SET header_msg_id = ? WHERE id = ?`
);

const stmtUpdateItemMsgId = db.prepare(
  `UPDATE items SET message_id = ? WHERE id = ?`
);

const stmtToggleItem = db.prepare(
  `UPDATE items SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END WHERE id = ?`
);

const stmtGetItem = db.prepare(
  `SELECT * FROM items WHERE id = ?`
);

// --- Public API ---

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

export interface ClearResult {
  count: number;
  headerMsgId: number | null;
  itemMsgIds: number[];
}

export function clearList(chatId: number): ClearResult {
  const list = stmtGetActiveList.get(chatId) as ListRow | undefined;
  if (!list) return { count: 0, headerMsgId: null, itemMsgIds: [] };

  const items = stmtGetItems.all(list.id) as ItemRow[];
  const headerMsgId = list.header_msg_id;
  const itemMsgIds = items
    .map((i) => i.message_id)
    .filter((id): id is number => id !== null);

  stmtDeleteItems.run(list.id);
  stmtDeleteList.run(list.id);

  return { count: items.length, headerMsgId, itemMsgIds };
}

export function updateListHeaderMsgId(listId: number, msgId: number): void {
  stmtUpdateHeaderMsgId.run(msgId, listId);
}

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


