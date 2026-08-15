# CLAUDE.md — workflow guidance

This is a Phaser + TypeScript + Vite prototype. See `PROJECT.md` for the
actual gameplay rules/tuning — keep that file updated when balance or rules
change; keep this file limited to workflow only.

## Commands

- `npm run dev` — start the Vite dev server (hot reload).
- `npm run build` — type-check (`tsc`) then production build. Always run
  this after changes and fix any errors before considering work done.
- `npm run preview` — serve the production build locally.

## Structure

- `src/game/tuning.ts` — every gameplay-balance constant lives here. Change
  numbers here, not scattered through screens/systems.
- `src/game/types.ts` — shared state shapes.
- `src/game/Game.ts` — the single source of gameplay logic/state mutation.
  UI code should call methods on this class rather than mutating state
  directly.
- `src/game/systems/` — pure(ish) logic: breeding, economy, market,
  calendar, names, save.
- `src/game/render/AppleVisual.ts` — the procedural apple graphic.
- `src/game/ui/` — Phaser `Container`-based screens/widgets. Each screen
  exposes a `render()` that redraws itself from current state.
- `src/game/scenes/MainScene.ts` — wires HUD, bottom nav, the 4 screens,
  and modals together; owns the update loop.

## Phaser 4 gotchas hit in this codebase

`Phaser.Scene` and `Phaser.GameObjects.Container` already define several
property/method names (`game`, `body`, `active`/`setActive`, `w`/`h` via
components). Don't reuse those names for your own class fields when
extending `Scene` or `Container` — pick something else (this project uses
`logic`, `content`, `activeTab`, `boxW`/`boxH` for that reason).

## Debug tools

A small "DBG" toggle lives in the bottom-right corner (separate from normal
UI): add cash, skip the day timer, speed up ticking, and reset the
prototype. These never alter core gameplay logic — they only fast-forward
or nudge existing state through the same code paths a normal action would
use.
