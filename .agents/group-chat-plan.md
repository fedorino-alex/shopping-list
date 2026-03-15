# Group Chat Support Plan

## Overview

Enable the bot to work in group chats for family shopping and party coordination.
Architecture already supports it — all DB and in-memory state is keyed by `chat_id`.
When the bot edits a message, Telegram pushes the update to every member instantly.

## User Flow

1. Bot is added to group → status message sent and **pinned automatically**
2. Normal party conversation continues — bot is completely silent
3. At any point, anyone adds items by:
   - Replying to the pinned status message with items, **or**
   - `@botname молоко, хлеб, сыр` (inline mention)
4. Shopping time: everyone sees the pinned message, taps **[Start Shopping]**
5. Each person marks items as bought in real-time — all group members see updates instantly

## Feature Requirements

### F1 — Auto-pin status message
- After sending the status message in a group, bot calls `pinChatMessage()` silently
- Applies on: bot added to group, `/start`, list cleared (re-IDLE), new list created
- Requires bot has **admin rights** with "Pin Messages" permission
- If pin fails (no rights), log and continue — not critical

### F2 — Auto-init on group join
- Add `bot.on("my_chat_member", ...)` handler
- Triggers when bot is added to group or supergroup
- Runs same init logic as `/start` (IDLE or NORMAL status message)
- Also fires correctly when bot is re-added after removal

### F3 — Reply-to-status adds items (privacy mode stays ON)
- User replies to the pinned status message with item text
- Bot detects `reply_to_message.message_id === status_msg_id` in DB
- Extracts items and adds to list (same extraction pipeline as AWAITING flow)
- Works with **privacy mode ON** — Telegram delivers replies-to-bot-messages in groups
- Available in any state where list exists (NORMAL, SHOPPING, EDITING)
- **No AWAITING state transition needed** — always available

### F4 — @mention adds items
- User sends `@botname молоко, хлеб, сыр` in the group
- Bot receives it (privacy mode ON or bot mentioned → always delivered)
- Same extraction + add pipeline
- Creates a new list if in IDLE state

### F5 — Duplicate detection
- Before adding new items, check existing visible items in the list
- Fuzzy match (case-insensitive, trimmed) against existing item names
- Skip duplicates silently or notify with a count: "2 уже в списке"

### F6 — Keep existing AWAITING flow for private chats
- In private chats: AWAITING flow unchanged (no risk of accidental triggers)
- In groups: AWAITING flow deprecated or disabled (too risky in active chat)
  - Reply-to-status and @mention are the group-safe alternatives

## Technical Design

### BotFather configuration (one-time user action)
- `/setprivacy` → Disable (only needed if @mention flow is insufficient; reply flow works without this)
- Actually: with reply-to-bot and @mention both working, **privacy mode can stay ON**

### `src/index.ts` changes
```ts
// Auto-init on group join
bot.on("my_chat_member", async (ctx) => {
  const newStatus = ctx.myChatMember.new_chat_member.status;
  if (newStatus !== "member" && newStatus !== "administrator") return;
  const chatType = ctx.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") return;
  // same logic as /start...
});

// Reply-to-status input
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const replyTo = ctx.message.reply_to_message?.message_id;
  const statusMsgId = getStatusMsgId(chatId); // from DB
  if (replyTo && replyTo === statusMsgId) {
    await handleAddItemsInput(ctx); // reuse existing extraction
    return;
  }
  // @mention input
  if (ctx.message.text.startsWith(`@${botUsername}`)) {
    // strip mention, extract items, add to list
  }
  // existing AWAITING flow for private chats...
});
```

### `src/status.ts` changes
- After `sendMessage`, if `ctx.chat.type` is group/supergroup, call `ctx.api.pinChatMessage(chatId, msg.message_id, { disable_notification: true })`
- Wrap in try/catch — pin failure is non-fatal

### `src/db.ts` changes
- Add `getStatusMsgId(chatId): number | null` helper (already stored in `chats` table)

### `src/handlers/edit.ts` / `src/handlers/list.ts` changes
- Refactor `handleAddItemsInput` to accept raw text string (not only from ctx.message.text)
  so it can be called from reply-to-status and @mention paths

### Duplicate detection
- New helper in `db.ts`: `findDuplicateItems(listId, names[])` returns names already in list
- Called before `addItemsToList`, returns `{ added, skipped }`
- If skipped > 0: reply/edit with info "X уже в списке"

## Files to Change

| File | Change |
|------|--------|
| `src/index.ts` | Add `my_chat_member` handler; add reply-to-status + @mention text routing |
| `src/status.ts` | Auto-pin after send/edit in group chats |
| `src/db.ts` | `getStatusMsgId()` helper; `findDuplicateItems()` helper |
| `src/handlers/list.ts` | Refactor to accept text string directly |
| `src/handlers/edit.ts` | Refactor `handleAddItemsInput` to accept text string |

## Out of Scope

- Admin-only list creation (any member can create/clear the list)
- Per-user item assignments
- Push notifications when another user modifies the list
- Multi-list support per group (one active list per chat)
