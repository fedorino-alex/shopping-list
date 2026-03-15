# Group Chat Support

How the bot behaves in group/supergroup chats — architecture, entry points, and UX differences vs private chats.

## How Bot Joins Groups

Bot joins **silently** — no status message is posted on join. A member must run `/start` to create the first status message and pin it.

The `my_chat_member` handler in `src/index.ts` fires on join but only logs the event.

## Input Routing (`src/index.ts`)

Group messages are processed in only two cases; everything else is silently ignored:

| Trigger | Condition | Handling |
|---------|-----------|----------|
| **@mention** | Message entities contain a `mention` matching `@botUsername` | Mention stripped from text, passed to `handleNLCommand` |
| **Reply to status** | `reply_to_message.message_id === getStatusMsgId(chatId)` | Full message text passed to `handleNLCommand` |

`handleNLCommand` uses `classifyAndExtract` (Groq LLM) to determine intent (add / remove / show / start_shopping / unknown).

## Status Message Lifecycle in Groups

All status message operations live in `src/status.ts`.

| Function | Group behaviour |
|----------|----------------|
| `sendStatusMessage(api, chatId, text, keyboard, chatType)` | Deletes + unpins old message, sends new one, **pins it** with `disable_notification: true`. Non-fatal if bot lacks Pin permission. |
| `editStatusMessage(api, chatId, text, keyboard)` | Edits in-place. No re-pin needed — the pinned message preview updates automatically. Falls back to send-new if edit fails. |
| `deleteStatusMessage(api, chatId, chatType)` | Unpins then deletes. Used on list clear (→ IDLE). |

`sendStatusMessage` is called by:
- `/start` command
- `coreStartShopping` — re-pins at the bottom of chat after department messages, so the pinned message is always the most recent item
- Group `afterAdd` when the very first items are added (IDLE → NORMAL)

`editStatusMessage` is called for all subsequent button presses and NL commands (no re-pin).

## UX Differences vs Private Chats

| | Private | Group |
|---|---------|-------|
| Input trigger | Any text message | @mention or reply-to-status only |
| User message deleted after add | ✅ Yes | ❌ Never |
| Confirmation reply after add | No (status edit is the feedback) | ✅ Reply with item count |
| Confirmation reply after remove | No | ✅ Reply with removed names |
| Status on 'show' NL command | Edited in-place | Deleted → re-sent → re-pinned at bottom |
| Status on clear (→ IDLE) | Edited to idle view | Unpinned and deleted |
| Unknown intent | No reply | Reply with hint |

All group vs private logic is encapsulated in `GroupWorkflow` / `PrivateWorkflow` in `src/handlers/workflow.ts`.

## Permissions Required

Bot needs the **"Pin Messages"** admin right to pin the status message. If absent, the message is still sent — pinning fails silently and the bot continues normally.

## Privacy Mode

Privacy mode can stay **ON** (Telegram default). The bot always receives:
- Messages where it is @mentioned
- Replies to any message it sent (including the pinned status message)

No BotFather `/setprivacy` change is needed.
