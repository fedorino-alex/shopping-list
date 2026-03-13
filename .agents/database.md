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
  name        TEXT NOT NULL,
  complete    INTEGER DEFAULT 0,
  hidden      INTEGER DEFAULT 0,   -- 1 = soft-deleted (compact or remove)
  created_at  TEXT DEFAULT (datetime('now'))
);
```

## Public API (src/db.ts)

| Function                                | Returns                   | Notes                                                   |
|-----------------------------------------|---------------------------|---------------------------------------------------------|
| `getChat(chatId)`                       | `ChatRow`                 | Upserts chat row, returns it                            |
| `updateStatusMsgId(chatId, msgId)`      | `void`                    | Stores persistent status message_id                     |
| `createList(chatId, names)`             | `number` (list ID)        | Inserts list + items in transaction                     |
| `getActiveList(chatId)`                 | `{ list, items } \| null` | Most recent non-deleted list; items includes hidden ones |
| `getVisibleItems(listId)`               | `ItemRow[]`               | Items where `hidden = 0`                                |
| `clearList(chatId)`                     | `ClearResult`             | Soft-deletes list + all items                           |
| `compactList(chatId)`                   | `CompactResult \| null`   | Hides completed visible items; returns allComplete flag |
| `toggleItem(itemId)`                    | `ItemRow \| null`         | Flips `complete` flag, returns updated row              |
| `updateItemMsgId(itemId, msgId)`        | `void`                    | Stores Telegram message_id per item                     |
| `getItem(itemId)`                       | `ItemRow \| null`         | Single item lookup                                      |
| `removeItem(itemId)`                    | `ItemRow \| null`         | Sets `hidden = 1`, returns row (with message_id)        |
| `addItemsToList(listId, chatId, names)` | `ItemRow[]`               | Appends items in transaction, returns new rows          |
