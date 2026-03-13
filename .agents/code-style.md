# Code Style & Design Decisions

## Code Style Guidelines

- **Diagrams**: Use Mermaid fenced blocks (` ```mermaid `) in all `.agents/` documentation. Prefer `stateDiagram-v2` for state machines, `flowchart TD` for flows. Do not use ASCII art diagrams.
- **TypeScript**: ES2022, Node16 modules, strict mode. `const` by default.
- **Naming**: files `kebab-case.ts`, functions `camelCase`, types `PascalCase`, DB columns `snake_case`.
- **Imports**: ES modules, grouped: node builtins > external > local (relative paths).
- **Errors**: try/catch around every Telegram API call. Log with context. Never crash.
- **Telegram**:
  - Always call `answerCallbackQuery()`.
  - `disable_notification: true` when sending item messages.
  - MarkdownV2 everywhere — use `escapeMarkdown()` on all user-facing strings.
  - Store all `message_id`s (status message + per-item messages).
  - Callback data format: `action:<name>` for state transitions, `toggle:<id>` for items, `remove:<id>` for edit-mode removal.
- **DB**: Synchronous `better-sqlite3`. Prepared statements at module level. Scope all queries by `chat_id`. Soft deletes via `deleted`/`hidden` — never hard-delete rows.

## Key Design Decisions

1. **Button-driven UI** — single persistent status message edited in-place across states. Only `/start` is a slash command; all actions use inline keyboard callbacks.
2. **One message per item** — avoids scrolling with long lists, keeps button next to its item text.
3. **Persistent status message** — `chat_id → status_msg_id` stored in `chats` table. `editStatusMessage()` falls back to sending a new message if the edit fails (deleted/too old).
4. **SQLite** — family-scale bot, no DB server needed. WAL mode enabled for concurrent reads.
5. **grammY** — best TypeScript types and active maintenance among Telegram frameworks.
6. **Two-step list creation** — [New List] sets AWAITING_INPUT; the next text message is parsed as comma-separated items. `awaitingList` Set is in-memory (lost on restart — acceptable).
7. **Soft deletes** — `lists.deleted` and `items.hidden` instead of hard DELETE. Clear sets `deleted = 1`. Compact and Remove set `hidden = 1`.
8. **In-memory auto-reset timer** — when all items are complete, a 5-minute `setTimeout` fires to silently clear the list. Cancelled by Clear List or Undo. Lost on bot restart (acceptable at family scale).
9. **Edit mode origin tracking** — `editOrigin Map<chatId, 'normal'|'shopping'>` remembers where editing started. On Done Editing: if normal, delete item messages and show NORMAL; if shopping, restore Done/Undo keyboards and show SHOPPING.
10. **No LLM in MVP** — comma-separated parsing only. NLP planned for future.
