# AGENTS.md - Shopping List Telegram Bot

## Maintaining This File

- Keep AGENTS.md in sync with the codebase after every meaningful change
  (new files, changed APIs, new commands, schema changes, etc.)
- If this file exceeds 200 lines, extract sections into `.agents/` folder
  as separate markdown files (e.g. `.agents/code-style.md`,
  `.agents/telegram-patterns.md`) and link to them from here.
- Project structure, commands reference, and schema sections are the
  source of truth — update them first when things change.

## Project Overview

A Telegram bot for family shopping list management. Users send a
comma-separated list of items, and the bot creates an interactive checklist
where each item is a separate message with a Done/Undo inline keyboard
button. Items can be toggled as completed in real-time during a shopping trip.

### Core Flow

1. User sends `/list`, bot prompts for items
2. User sends `bread, milk, beer, eggs`
3. Bot saves items to DB, confirms with count
4. User sends `/shop` — bot sends a header message + one message per item,
   each with a \[Done\] inline button
5. User taps \[Done\] — item text gets strikethrough, button becomes \[Undo\],
   header counter updates
6. `/clear` deletes all list messages from chat and clears DB

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
    index.ts              # Entry point: bot creation, command/handler registration, startup
    db.ts                 # SQLite schema, migrations, all CRUD (prepared statements)
    render.ts             # MarkdownV2 escaping, header/item text, inline keyboard builder
    logger.ts             # Structured logger: debug/info/error with timestamps and tags
    handlers/
      list.ts             # /list command — two-step flow (prompt -> parse comma-separated)
      shop.ts             # /shop command — sends header + per-item messages with buttons
      clear.ts            # /clear command — deletes Telegram messages + DB data
      callback.ts         # Inline button handler — toggles done/undone, edits messages
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

| Command   | Description                                            |
|-----------|--------------------------------------------------------|
| `/start`  | Show help text                                         |
| `/list`   | Create new list (two-step: prompts, then parses input) |
| `/shop`   | Display current list with Done/Undo inline buttons     |
| `/clear`  | Delete all list messages from chat and clear DB        |

## Database Schema

```sql
CREATE TABLE lists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        INTEGER NOT NULL,
  header_msg_id  INTEGER,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id     INTEGER NOT NULL REFERENCES lists(id),
  chat_id     INTEGER NOT NULL,
  message_id  INTEGER,
  name        TEXT NOT NULL,
  done        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

## Key DB Functions (src/db.ts)

| Function                | Returns                    | Notes                              |
|-------------------------|----------------------------|------------------------------------|
| `createList(chatId, names)` | `number` (list ID)     | Inserts list + items in transaction|
| `getActiveList(chatId)` | `{ list, items } \| null`  | Most recent list for this chat     |
| `clearList(chatId)`     | `ClearResult`              | Returns count + message IDs for deletion |
| `toggleItem(itemId)`    | `ItemRow \| null`          | Flips done flag, returns updated row |
| `updateListHeaderMsgId` | `void`                     | Stores Telegram message_id         |
| `updateItemMsgId`       | `void`                     | Stores Telegram message_id         |

## Environment Variables

| Variable    | Required | Default | Description                        |
|-------------|----------|---------|------------------------------------|
| `BOT_TOKEN` | Yes      | —       | Telegram bot token from @BotFather |
| `LOG_LEVEL` | No       | `debug` | `debug`, `info`, or `error`        |

## Code Style Guidelines

See full details in `.agents/code-style.md` if it exists, otherwise:

- **TypeScript**: ES2022, Node16 modules, strict mode. `const` by default.
- **Naming**: files `kebab-case.ts`, functions `camelCase`, types `PascalCase`,
  DB columns `snake_case`.
- **Imports**: ES modules, grouped: node builtins > external > local (relative paths).
- **Errors**: try/catch around every Telegram API call. Log with context. Never crash.
- **Telegram**: `answerCallbackQuery()` always. `disable_notification: true` for items.
  MarkdownV2 with `escapeMarkdown()`. Store all `message_id`s. Callback data: `toggle:<id>`.
- **DB**: Synchronous `better-sqlite3`. Prepared statements. Scope queries by `chat_id`.

## Key Design Decisions

1. **One message per item** — avoids scrolling with long lists, keeps button
   next to its item text.
2. **SQLite** — family-scale bot, no DB server needed.
3. **grammY** — best TypeScript types and active maintenance among Telegram frameworks.
4. **Two-step `/list` flow** — `/list` prompts, next message parsed as items.
   Simpler than inline argument parsing, supports long item lists.
5. **No LLM in MVP** — comma-separated parsing only. NLP planned for future.
