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

export type NLCommandStep =
  | { intent: 'add'; groups: ExtractedGroup[] }
  | { intent: 'remove'; query: string }  // query = normalized removal phrase, e.g. "вино"
  | { intent: 'show' }
  | { intent: 'start_shopping' }
  | { intent: 'unknown' };

/** @deprecated alias for NLCommandStep */
export type NLCommand = NLCommandStep;
```

| Function                              | Returns                    | Description |
|---------------------------------------|----------------------------|-------------|
| `classifyAndExtract(text, state)`     | `Promise<NLCommandStep[]>` | Single Groq call: classifies intent AND extracts items/query. Returns an **ordered array** — usually one element, but two for compound messages like "убери X и добавь Y" or "замени X на Y". Returns `[{intent:'unknown'}]` if Groq key absent or on error. |
| `resolveRemoveTargets(query, items)`  | `Promise<ItemRow[]>`       | Given a removal query and visible items list, uses Groq semantically to find which items match (e.g. "вино" → ["белое вино", "красное вино"]). Substring fallback if Groq unavailable. |

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
| `handleNLCommand(ctx, text)` | `Promise<void>` | Central NL dispatch: calls `classifyAndExtract` (returns `NLCommandStep[]`). Single step → routes to dedicated handler. Multiple steps (compound) → runs each DB-only, then a single UI update at end. |

**Single-step intents dispatched:**
- `add` → adds items, deduplicates by `code`; delegates feedback to `workflow.afterAdd`
- `remove` → calls `resolveRemoveTargets` then `removeItem` for matched items; delegates feedback to `workflow.afterRemove`
- `show` → delegates to `workflow.afterShow`
- `start_shopping` → guards, delegates to `coreStartShopping` then `workflow.afterStartShopping`
- `unknown` → `workflow.replyUnknown`

**Compound path** (e.g. "убери молоко и добавь кефир", "замени X на Y"):
- Iterates steps in order; each step runs only DB operations (no UI)
- After all steps: for groups sends one combined summary reply; for all chat types calls `editStatusMessage` once
- If list is empty after compound: IDLE transition (group → `deleteStatusMessage`, private → `editStatusMessage` to idle)

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
