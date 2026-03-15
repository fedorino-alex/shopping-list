# API Reference

## src/extractor.ts

### Types

```ts
export interface ExtractedItem {
  code: string;       // canonical base/nominative product name (e.g. "картошка", "белое вино")
  details?: string;   // optional quantity/weight (e.g. "1кг", "2л")
}

export interface ExtractedGroup {
  group: string;          // Russian department name (from supermarket-sections.md)
  items: ExtractedItem[]; // structured items with code + optional details
}

export type BotState = 'IDLE' | 'NORMAL' | 'SHOPPING';

export type NLCommand =
  | { intent: 'add'; groups: ExtractedGroup[] }
  | { intent: 'remove'; query: string }  // query = normalized removal phrase, e.g. "вино"
  | { intent: 'show' }
  | { intent: 'start_shopping' }
  | { intent: 'unknown' };
```

| Function                                   | Returns                   | Description |
|--------------------------------------------|---------------------------|-------------|
| `extractItems(text)`                       | `Promise<ExtractedGroup[]>` | Pure item extraction (kept for test-extractor.ts). Groq llama-3.3-70b if key set; heuristic fallback. |
| `classifyAndExtract(text, state)`          | `Promise<NLCommand>`      | Single Groq call: classifies intent AND extracts items (if 'add') or query (if 'remove'). Passes `BotState` as context. Heuristic keyword fallback if Groq unavailable. |
| `resolveRemoveTargets(query, items)`       | `Promise<ItemRow[]>`      | Given a removal query and visible items list, uses Groq semantically to find which items match (e.g. "вино" → ["белое вино", "красное вино"]). Substring fallback. |

## src/handlers/workflow.ts

Defines the `ChatWorkflow` abstraction — separates private-vs-group post-action UX.

### Interface

```ts
export interface ChatWorkflow {
  afterAdd(ctx, prevState, listId, totalAdded, dupCount): Promise<void>;
  afterRemove(ctx, listId, removed): Promise<void>;
  afterShow(ctx, state, listId): Promise<void>;
  afterStartShopping(ctx): Promise<void>;
  replyUnknown(ctx, state): Promise<void>;
}
```

| Export | Description |
|--------|-------------|
| `getWorkflow(chatType)` | Singleton factory — returns `PrivateWorkflow` for `'private'`, `GroupWorkflow` for groups |
| `buildStatusContent(state, visible)` | Returns `{ text, keyboard }` for NORMAL/SHOPPING states. Used by both workflows. |
| `pluralItems(count)` | Russian plural form for item count (товар / товара / товаров) |

**PrivateWorkflow** — status message is the live list UI; updated after every change; user messages deleted; no confirmation replies.

**GroupWorkflow** — pinned message is the anchor; confirmation replies sent after every action; status re-pinned on `show` and on first-ever add (IDLE→NORMAL); subsequent adds silently edit pinned in place.

## src/handlers/nlcommand.ts

| Function                     | Returns         | Description |
|------------------------------|-----------------|-------------|
| `getBotState(chatId)`        | `BotState`      | Derives current state from DB + in-memory sets (no active list → IDLE; shopping → SHOPPING; else NORMAL) |
| `handleNLCommand(ctx, text)` | `Promise<void>` | Central NL dispatch: classify intent → route to add/remove/show/start_shopping/unknown handler. Calls `getWorkflow(ctx.chat.type)` to get chat-specific UX. |

**Intents dispatched:**
- `add` → adds items, deduplicates by `code`; delegates feedback to `workflow.afterAdd`
- `remove` → calls `resolveRemoveTargets` then `removeItem` for matched items; delegates feedback to `workflow.afterRemove`
- `show` → delegates to `workflow.afterShow`
- `start_shopping` → guards, delegates to `coreStartShopping` then `workflow.afterStartShopping`
- `unknown` → `workflow.replyUnknown`

All private/group UX differences are encapsulated in `ChatWorkflow` implementations — no `isGroup` checks in this file.

## src/status.ts

| Function | Description |
|----------|-------------|
| `editStatusMessage(api, chatId, text, keyboard?)` | Edit persistent status msg in-place; sends new + updates DB if fails |
| `sendStatusMessage(api, chatId, text, keyboard?, chatType?)` | Delete old status msg + send fresh one; auto-pins in group/supergroup if `chatType` provided |
| `deleteStatusMessage(api, chatId, chatType?)` | Unpin (groups only) + delete the status message + call `clearStatusMsgId`. Used on [Clear List] in group chats. |
| `deleteMessages(api, chatId, msgIds)` | Delete Telegram messages by IDs, ignoring failures |

## src/render.ts

### Status renderers (return `{ text, keyboard? }`)

| Function                      | State    | Description |
|-------------------------------|----------|-------------|
| `renderIdleStatus()`          | IDLE     | "Список покупок пуст. Напишите что купить..." — no keyboard |
| `renderNormalStatus(items)`   | NORMAL   | Items grouped by department with emoji header, bullet list, footer total. [Start Shopping] [Clear List] |
| `renderShoppingStatus(items)` | SHOPPING | Done counter (X/Y куплено) + [Compact] [Finish] |
| `renderListSummary(items)`    | any      | Plain-text (no MarkdownV2) dept-grouped list. Used for NL "show" chat reply. |

### Group + item renderers

| Function                            | Returns          | Description |
|-------------------------------------|------------------|-------------|
| `renderGroupMessage(groupName, items)` | `{ text, keyboard }` | SHOPPING mode: one Telegram message per dept group. Header `🥩 *Мясо и птица*`, active items as `• name`, complete as `✅ ~name~`. One toggle button per item per row. |
| `renderItemName(item)`              | `string`         | `code + (details ? ', ' + details : '')` — canonical display string used throughout renderers |
| `escapeMarkdown(text)`              | `string`         | Escapes MarkdownV2 special chars |

## src/handlers/shop.ts — exported helpers

| Function                         | Description |
|----------------------------------|-------------|
| `coreStartShopping(chatId, api)` | Core shopping logic (edits status + sends dept group messages). Called by button handler and NL handler. |
| `isShoppingMode(chatId)`         | True when chat is in SHOPPING state (in-memory tracking) |
| `cancelShoppingMode(chatId)`     | Clears shopping state (call on finish/clear/auto-reset) |

## src/handlers/compact.ts — timer helpers

| Function                         | Description |
|----------------------------------|-------------|
| `scheduleAutoReset(chatId, api)` | Schedule 30s silent list clear (auto-reset when all items bought) |
| `cancelAutoReset(chatId)`        | Cancel pending auto-reset timer |
