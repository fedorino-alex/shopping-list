# API Reference

## src/extractor.ts

| Function                      | Returns           | Description                                          |
|-------------------------------|-------------------|------------------------------------------------------|
| `extractItems(text)`          | `Promise<string[]>` | Extract grocery item names from free-form text. Uses Gemini Flash if `GEMINI_API_KEY` is set; otherwise falls back to heuristic splitting on `,` `\n` `;` `-` `•`. Strips quantities, units, and numbering. Preserves input language (Russian, English, etc.). |
## src/status.ts

| Function                | Description                                                         |
|-------------------------|---------------------------------------------------------------------|
| `editStatusMessage()`   | Edit persistent status msg in-place; sends new + updates DB if fails |
| `sendStatusMessage()`   | Delete old status msg + send fresh one (used by /start)             |
| `deleteMessages()`      | Delete Telegram messages by IDs, ignoring failures                  |

## src/render.ts

### Status renderers (return `{ text, keyboard? }`)

| Function                   | State        | Description                              |
|----------------------------|--------------|------------------------------------------|
| `renderIdleStatus()`       | IDLE         | "No active list." + [New List]           |
| `renderAwaitingStatus()`   | AWAITING_INPUT | Prompt text, no keyboard               |
| `renderNormalStatus(n)`    | NORMAL       | Item count + [Start Shopping] [Clear List] [Edit List] |
| `renderShoppingStatus(items)` | SHOPPING  | Done counter + [Compact] [Clear List] [Edit List] |
| `renderEditingStatus(n)`   | EDITING      | Item count + [Add Items] [Done Editing]  |
| `renderAwaitingAddStatus()` | AWAITING_ADD | Prompt text, no keyboard               |

### Item renderers

| Function                        | Returns         | Description                           |
|---------------------------------|-----------------|---------------------------------------|
| `renderItemText(item)`          | `string`        | Item name; ✅ + strikethrough if done |
| `renderItemKeyboard(item)`      | `InlineKeyboard`| [Done] or [Undo] toggle button        |
| `renderItemRemoveKeyboard(item)`| `InlineKeyboard`| [Remove] button (EDITING state only)  |
| `escapeMarkdown(text)`          | `string`        | Escapes MarkdownV2 special chars       |

## src/handlers/edit.ts — exported state helpers

| Function              | Description                                          |
|-----------------------|------------------------------------------------------|
| `isAwaitingAdd(chatId)` | True when chat is in AWAITING_ADD sub-state        |
| `isEditingList(chatId)` | True when chat has an active editOrigin entry      |
| `cancelEditState(chatId)` | Clears editOrigin + awaitingAdd (call on clear/new list) |

## src/handlers/compact.ts — timer helpers

| Function                              | Description                                  |
|---------------------------------------|----------------------------------------------|
| `scheduleAutoReset(chatId, api, confirmMsgId?)` | Schedule 5-min silent list clear   |
| `cancelAutoReset(chatId)`             | Cancel pending auto-reset timer              |
