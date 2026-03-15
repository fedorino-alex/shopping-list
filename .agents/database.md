# Database Reference

## Schema

Uses soft deletes: `lists.deleted` and `items.hidden` columns.
`getActiveList` filters by `deleted = 0`. Shopping/editing shows only `hidden = 0` items.

```sql
CREATE TABLE chats (
  chat_id        INTEGER PRIMARY KEY,
  status_msg_id  INTEGER           -- Telegram message_id of persistent status message
);

CREATE TABLE lists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        INTEGER NOT NULL,
  deleted        INTEGER DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id     INTEGER NOT NULL REFERENCES lists(id),
  chat_id     INTEGER NOT NULL,
  message_id  INTEGER,             -- Telegram message_id; set after message is sent
  code        TEXT NOT NULL,       -- canonical base/nominative product name (e.g. "картошка", "белое вино")
  details     TEXT,                -- optional quantity/weight (e.g. "1кг", "2л") — NULL if not specified
  "group"     TEXT NOT NULL DEFAULT '',  -- supermarket department name from LLM
  complete    INTEGER DEFAULT 0,
  hidden      INTEGER DEFAULT 0,   -- 1 = soft-deleted (compact or remove)
  created_at  TEXT DEFAULT (datetime('now'))
);
```

The `group` column is added to existing databases at startup via a safe `ALTER TABLE` (no-op if the column already exists). The `code`/`details` columns replaced `name`; existing databases are migrated via table recreation at startup.

## Public API (src/db.ts)

| Function                                        | Returns                   | Notes                                                   |
|-------------------------------------------------|---------------------------|---------------------------------------------------------|
| `getChat(chatId)`                               | `ChatRow`                 | Upserts chat row, returns it                            |
| `updateStatusMsgId(chatId, msgId)`              | `void`                    | Stores persistent status message_id                     |
| `createList(chatId, groups)`                    | `number` (list ID)        | Inserts list + items in transaction; `groups` is `{ group: string; items: ExtractedItem[] }[]` where `ExtractedItem = { code: string; details?: string }` |
| `getActiveList(chatId)`                         | `{ list, items } \| null` | Most recent non-deleted list; items includes hidden ones |
| `getVisibleItems(listId)`                       | `ItemRow[]`               | Items where `hidden = 0`                                |
| `getItemsByGroup(listId, groupName)`            | `ItemRow[]`               | Non-hidden items for one department group, ordered by id; used by toggle + compact handlers |
| `clearList(chatId)`                             | `ClearResult`             | Soft-deletes list + all items                           |
| `compactList(chatId)`                           | `CompactResult \| null`   | Hides completed visible items; returns `deletedMsgIds` (fully-done groups) and `updatedGroups` (partially-done groups to re-render) |
| `toggleItem(itemId)`                            | `ItemRow \| null`         | Flips `complete` flag, returns updated row              |
| `updateItemMsgId(itemId, msgId)`                | `void`                    | Stores Telegram message_id per item (all items in a group share one message_id in SHOPPING mode) |
| `getItem(itemId)`                               | `ItemRow \| null`         | Single item lookup                                      |
| `removeItem(itemId)`                            | `ItemRow \| null`         | Sets `hidden = 1`, returns row (with message_id)        |
| `getStatusMsgId(chatId)`                        | `number \| null`          | Returns `status_msg_id` for reply-to-status matching; null if not set |
| `clearStatusMsgId(chatId)`                      | `void`                    | Sets `status_msg_id = NULL` in DB (called after status message is deleted) |
| `findDuplicateItems(listId, codes[])`           | `string[]`                | Case-insensitive check of `code` against visible items; returns subset of `codes` already in the list |
| `addItemsToList(listId, chatId, groups)`        | `ItemRow[]`               | Appends items in transaction, returns new rows; same `groups` shape as `createList` |
