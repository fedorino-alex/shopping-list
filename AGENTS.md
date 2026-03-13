# AGENTS.md - Shopping List Telegram Bot

## Maintaining This File

- Keep AGENTS.md in sync with the codebase after every meaningful change
  (new files, changed APIs, new commands, schema changes, etc.)
- If this file exceeds 200 lines, extract sections into `.agents/` folder
  as separate markdown files (e.g. `.agents/code-style.md`,
  `.agents/telegram-patterns.md`) and link to them from here.
- Project structure, commands reference, and schema sections are the
  source of truth -- update them first when things change.

## Project Overview

A Telegram bot for family shopping list management with a **fully
button-driven UI**. A single persistent **status message** with inline
keyboard buttons drives all state transitions. Users send comma-separated
items as text, but all other interactions happen through inline buttons.
Each shopping list item is a separate Telegram message with its own
Done/Undo inline keyboard button.

### Core Flow

1. User sends `/start` -- bot creates persistent status message: "No active list" with [New List]
2. User taps [New List] -- status edits to "Send me a comma-separated list..."
3. User sends `bread, milk, beer, eggs` -- bot saves items, status edits to "Shopping List: 4 items" with [Start Shopping] [Clear List]
4. User taps [Start Shopping] -- status becomes header "Shopping List (0/4 done)" with [Compact] [Clear List], bot sends one message per item with [Done] button
5. User taps [Done] on an item -- item text gets strikethrough, button becomes [Undo], header counter updates
6. [Compact] hides completed items mid-shopping; when all items complete, sends confirmation + schedules 5-min auto-clear
7. [Clear List] soft-deletes all list data, removes item messages, resets status to IDLE

### State Machine

```
/start
  |
  v
IDLE --[New List]--> AWAITING_INPUT --(text received)--> NORMAL
  ^                       |                                |
  |                  (empty/invalid -> stays AWAITING)     |
  |                                                        |
  |<-----------[Clear List]--------------------------------|
  |                                                        |
  |                                              [Start Shopping]
  |                                                        |
  |                                                        v
  |<-----------[Clear List]------------------------ SHOPPING
  |                                                |     ^
  |                                           [Compact]  |
  |                                                |     |
  |                                                +-----+
  |<----------(auto-reset after 5 min when all complete)--+
```

### Future Iterations

- Natural language parsing (LLM-based) instead of comma-separated input
- Grouped items by shop area (single message with multiple buttons per group)
- Multiple concurrent lists
- Shared family group chat support

## Tech Stack

| Component     | Choice                  | Rationale                                 |
|---------------|-------------------------|-------------------------------------------|
| Runtime       | Node.js + TypeScript    | Type safety, modern async, good ecosystem |
| Bot framework | grammY                  | Modern, well-typed Telegram bot framework |
| Database      | SQLite (better-sqlite3) | Zero config, file-based persistence       |
| Dev runner    | tsx                     | Fast TS execution without build step      |
| Build         | tsc                     | Standard TypeScript compiler              |

## Project Structure

```
shopping-list/
  package.json
  tsconfig.json
  .env                    # BOT_TOKEN, LOG_LEVEL (never committed)
  AGENTS.md
  src/
    index.ts              # Entry point: /start only, callback routing, text routing
    db.ts                 # SQLite: chats/lists/items tables, all CRUD, soft deletes
    render.ts             # Status renderers (idle/awaiting/normal/shopping), item renderers
    status.ts             # editStatusMessage, sendStatusMessage, deleteMessages helpers
    logger.ts             # Structured logger: debug/info/error with timestamps and tags
    handlers/
      callback.ts         # Central callback router: action:* dispatch + toggle:* handling
      list.ts             # [New List] button + text input handler, awaitingList Set
      shop.ts             # [Start Shopping] button -- sends per-item messages
      clear.ts            # [Clear List] button -- soft-delete + cleanup
      compact.ts          # [Compact] button + auto-reset timer (scheduleAutoReset/cancelAutoReset)
```

## Build & Run Commands

```bash
npm install                        # Install dependencies
npx tsx watch src/index.ts         # Dev with hot reload
npx tsx src/index.ts               # Run once
npx tsc --noEmit                   # Type check
npx tsc                            # Build to dist/
node dist/index.js                 # Run production build
npx vitest run                     # Run tests (when added)
```

## Bot Commands

| Command  | Description                                                    |
|----------|----------------------------------------------------------------|
| `/start` | Only slash command. Sends persistent status message (IDLE or NORMAL) |

All other interactions are button-driven (inline keyboard callbacks).

## Callback Data Format

| Pattern                   | Handler                 | Description                     |
|---------------------------|-------------------------|---------------------------------|
| `action:new_list`         | `list.handleNewList`    | Transition IDLE -> AWAITING     |
| `action:start_shopping`   | `shop.handleStartShopping` | Transition NORMAL -> SHOPPING |
| `action:clear_list`       | `clear.handleClearList` | Transition any -> IDLE          |
| `action:compact`          | `compact.handleCompact` | Hide completed items in SHOPPING |
| `toggle:<item_id>`        | `callback.handleToggle` | Flip item complete/active       |

## Status Message Content Per State

| State            | Text                                 | Buttons                          |
|------------------|--------------------------------------|----------------------------------|
| IDLE             | "No active list."                    | [New List]                       |
| AWAITING_INPUT   | "Send me a comma-separated list..." | (none)                           |
| NORMAL           | "Shopping List: N items"            | [Start Shopping] [Clear List]    |
| SHOPPING         | "Shopping List (X/Y done)"          | [Compact] [Clear List]           |

## Database Schema

Uses soft deletes: `lists.deleted` and `items.hidden` columns.
`getActiveList` filters by `deleted = 0`. Shopping shows only `hidden = 0` items.

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
  message_id  INTEGER,
  name        TEXT NOT NULL,
  complete    INTEGER DEFAULT 0,
  hidden      INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

## Key DB Functions (src/db.ts)

| Function                      | Returns                   | Notes                                |
|-------------------------------|---------------------------|--------------------------------------|
| `getChat(chatId)`             | `ChatRow`                 | Upserts chat row, returns it         |
| `updateStatusMsgId(chatId,m)` | `void`                    | Stores persistent status message_id  |
| `createList(chatId, names)`   | `number` (list ID)        | Inserts list + items in transaction  |
| `getActiveList(chatId)`       | `{ list, items } \| null` | Most recent non-deleted list         |
| `getVisibleItems(listId)`     | `ItemRow[]`               | Items where `hidden = 0`            |
| `clearList(chatId)`           | `ClearResult`             | Soft-deletes list + items            |
| `compactList(chatId)`         | `CompactResult \| null`   | Hides completed items, checks allComplete |
| `toggleItem(itemId)`          | `ItemRow \| null`         | Flips `complete` flag                |
| `updateItemMsgId(id, msgId)`  | `void`                    | Stores Telegram message_id per item  |
| `getItem(itemId)`             | `ItemRow \| null`         | Single item lookup                   |

## Key Utility Functions

### src/status.ts

| Function               | Description                                                    |
|------------------------|----------------------------------------------------------------|
| `editStatusMessage()`  | Edit persistent status msg; if edit fails, sends new + updates DB |
| `sendStatusMessage()`  | Delete old status msg + send fresh one (used by /start)        |
| `deleteMessages()`     | Delete Telegram messages by IDs, ignoring failures             |

### src/render.ts

| Function                   | Returns                    | Description                     |
|----------------------------|----------------------------|---------------------------------|
| `escapeMarkdown(text)`     | `string`                   | Escapes MarkdownV2 special chars |
| `renderIdleStatus()`       | `{ text, keyboard }`       | IDLE state display               |
| `renderAwaitingStatus()`   | `{ text }`                 | AWAITING_INPUT display (no buttons) |
| `renderNormalStatus(n)`    | `{ text, keyboard }`       | NORMAL state with item count     |
| `renderShoppingStatus(items)` | `{ text, keyboard }`    | SHOPPING header with done counter |
| `renderItemText(item)`     | `string`                   | Item name, strikethrough if done |
| `renderItemKeyboard(item)` | `InlineKeyboard`           | Done/Undo button for item        |

## Environment Variables

| Variable    | Required | Default | Description                        |
|-------------|----------|---------|------------------------------------|
| `BOT_TOKEN` | Yes      | --      | Telegram bot token from @BotFather |
| `LOG_LEVEL` | No       | `debug` | `debug`, `info`, or `error`        |

## Code Style Guidelines

- **TypeScript**: ES2022, Node16 modules, strict mode. `const` by default.
- **Naming**: files `kebab-case.ts`, functions `camelCase`, types `PascalCase`,
  DB columns `snake_case`.
- **Imports**: ES modules, grouped: node builtins > external > local (relative paths).
- **Errors**: try/catch around every Telegram API call. Log with context. Never crash.
- **Telegram**: `answerCallbackQuery()` always. `disable_notification: true` for items.
  MarkdownV2 with `escapeMarkdown()`. Store all `message_id`s.
  Callback data: `action:<name>` for state transitions, `toggle:<id>` for items.
- **DB**: Synchronous `better-sqlite3`. Prepared statements. Scope queries by `chat_id`.
  Soft deletes via `deleted`/`hidden` columns -- never hard-delete rows.

## Key Design Decisions

1. **Button-driven UI** -- single persistent status message edited in-place
   across states. Only `/start` is a slash command. All actions via inline
   keyboard buttons.
2. **One message per item** -- avoids scrolling with long lists, keeps button
   next to its item text.
3. **Persistent status message** -- stored in `chats.status_msg_id`. Edited
   via `editStatusMessage()` which falls back to sending new if edit fails.
4. **SQLite** -- family-scale bot, no DB server needed.
5. **grammY** -- best TypeScript types and active maintenance among Telegram frameworks.
6. **Two-step list flow** -- [New List] sets AWAITING, next text message parsed
   as comma-separated items. `awaitingList` Set is in-memory (lost on restart).
7. **Soft deletes** -- `lists.deleted` and `items.hidden` instead of hard DELETE.
   Clear marks `deleted = 1`. Compact marks completed items `hidden = 1`.
8. **In-memory auto-reset timer** -- when all items are complete (detected via
   toggle or compact), a 5-minute `setTimeout` fires to silently clear the list.
   Cancelled by Clear List or Undo. Lost on bot restart (acceptable at family scale).
9. **No LLM in MVP** -- comma-separated parsing only. NLP planned for future.
