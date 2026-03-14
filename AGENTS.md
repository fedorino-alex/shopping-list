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

A Telegram bot for family shopping list management with a **fully button-driven UI**.
A single persistent **status message** drives all state transitions via inline keyboard buttons.
Users send free-form text (items, recipes, any language); all other interactions are button-driven.
Each shopping list item is a separate Telegram message with its own inline button.

States: `IDLE → AWAITING_INPUT → NORMAL ⇄ SHOPPING`, plus `EDITING` and `AWAITING_ADD`
reachable from NORMAL only. See [`.agents/state-machine.md`](.agents/state-machine.md).

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
    index.ts              # Entry point: /start, callback routing, text routing
    db.ts                 # SQLite: chats/lists/items tables, all CRUD, soft deletes
    extractor.ts          # Free-form text → item names via Groq llama-3.3-70b (heuristic fallback)
    render.ts             # Status + item renderers (all states)
    status.ts             # editStatusMessage, sendStatusMessage, deleteMessages
    logger.ts             # Structured logger: debug/info/error with timestamps
    handlers/
      callback.ts         # Central callback router: action:* / toggle:* / remove:*
      list.ts             # [New List] + text input → AWAITING_INPUT / NORMAL
      shop.ts             # [Start Shopping] → sends per-item messages
      clear.ts            # [Clear List] → soft-delete + cleanup → IDLE
      compact.ts          # [Compact] + scheduleAutoReset / cancelAutoReset
      edit.ts             # [Edit List] / [Remove] / [Add Items] / [Done Editing]
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
| `GROQ_API_KEY`   | No       | —       | Groq API key for free-form item extraction (llama-3.3-70b); heuristic fallback used if absent |
| `LOG_LEVEL`      | No       | `debug` | `debug`, `info`, or `error`                                              |

## Bot Commands

| Command  | Description                                                          |
|----------|----------------------------------------------------------------------|
| `/start` | Only slash command. Sends persistent status message (IDLE or NORMAL) |

All other interactions are button-driven (inline keyboard callbacks).
See [`.agents/state-machine.md`](.agents/state-machine.md) for the full callback reference.
