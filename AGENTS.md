# AGENTS.md - Shopping List Telegram Bot

## Maintaining This File

- Keep AGENTS.md and the `.agents/` files in sync with the codebase after every
  meaningful change (new files, changed APIs, new commands, schema changes, etc.)
- This file is the quick-reference index. Detailed docs live in `.agents/`:
  - [`.agents/state-machine.md`](.agents/state-machine.md) — Core flow, state machine diagram, status message states, callback data format, future iterations
  - [`.agents/database.md`](.agents/database.md) — SQL schema, DB public API
  - [`.agents/api-reference.md`](.agents/api-reference.md) — render.ts, status.ts, and handler utility functions
  - [`.agents/code-style.md`](.agents/code-style.md) — Code style guidelines, key design decisions
  - [`.agents/supermarket-sections.md`](.agents/supermarket-sections.md) — Full department/product list used to inform the LLM extraction prompt
- Update the relevant `.agents/` file first, then update the summary here if needed.
- Use Mermaid diagrams (` ```mermaid `) in `.agents/` docs — not ASCII art.

## Project Overview

A Telegram bot for family shopping list management with a **fully button-driven UI** augmented by **natural language commands**.
A single persistent **status message** drives all state transitions via inline keyboard buttons.
All text is NL-classified (Groq LLM + heuristic fallback): add items, show list, or start shopping — no explicit AWAITING state.

**Private chat:** any text typed is processed as a command. User messages are deleted after `add` and `start_shopping` to keep the chat clean; the status message serves as the only persistent UI element.

**Group chat:** bot joins silently (no message). It only responds when @mentioned or when someone replies to the pinned status message. After any NL command, the old status is unpinned and deleted, and a fresh status is posted at the bottom and repinned — so the pinned message is always current and at the chat bottom. User messages in groups are never deleted. Button presses on the pinned message edit it in place (no re-pin).

States: `IDLE → NORMAL ⇄ SHOPPING`, plus `EDITING` reachable from NORMAL only. See [`.agents/state-machine.md`](.agents/state-machine.md).

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
  AGENTS.md               # This file — quick-reference index
  .agents/                # Detailed documentation sections
    state-machine.md          # States, transitions, callback data, UI reference
    database.md               # Schema + DB API
    api-reference.md          # render.ts / status.ts / handler utility functions
    code-style.md             # Code style guidelines + design decisions
    supermarket-sections.md   # All supermarket departments + products (informs LLM prompt)
  src/
    index.ts              # Entry point: /start, my_chat_member, callback routing, NL text routing
    db.ts                 # SQLite: chats/lists/items tables, all CRUD, soft deletes
    extractor.ts          # classifyAndExtract(text, state) → NLCommandStep[]; resolveRemoveTargets for NL remove
    render.ts             # Status + item renderers (all states); renderListSummary for NL show reply
    status.ts             # editStatusMessage, sendStatusMessage (auto-pins in groups), deleteMessages
    logger.ts             # Structured logger: debug/info/error with timestamps
    handlers/
      callback.ts         # Central callback router: action:* / toggle:* / remove:*
      nlcommand.ts        # NL dispatch: getBotState, handleNLCommand → add/remove/show/start_shopping/unknown

      shop.ts             # coreStartShopping; [Start Shopping] / [Finish]; shopping state tracking
      clear.ts            # [Clear List] → soft-delete + cleanup → IDLE
      compact.ts          # [Compact] (delete/re-render group msgs) + scheduleAutoReset / cancelAutoReset
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

## Environment Variables

| Variable         | Required | Default | Description                                                              |
|------------------|----------|---------|--------------------------------------------------------------------------|
| `BOT_TOKEN`      | Yes      | —       | Telegram bot token from @BotFather                                       |
| `GROQ_API_KEY`   | No*      | —       | LLM API key. Required for Groq. Not needed for local Ollama — set `LLM_BASE_URL` instead. Without both → all text → "unknown". |
| `LLM_BASE_URL`   | No       | Groq URL | Override LLM endpoint. Set to `http://localhost:11434/v1/chat/completions` for Ollama. |
| `LLM_MODEL`      | No       | `llama-3.3-70b-versatile` | Model name. For Ollama use e.g. `qwen2.5:14b`. |
| `LOG_LEVEL`      | No       | `debug` | `debug`, `info`, or `error`                                              |

## Bot Commands

| Command  | Description                                                          |
|----------|----------------------------------------------------------------------|
| `/start` | Only slash command. Sends persistent status message (IDLE or NORMAL) |

All other interactions are button-driven (inline keyboard callbacks).
See [`.agents/state-machine.md`](.agents/state-machine.md) for the full callback reference.
