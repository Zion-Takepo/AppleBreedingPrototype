# Apple Breeding Prototype — PROJECT.md

Source of truth for this prototype's actual implemented rules. If code and
this file disagree, treat this file as intent and the code as a bug to fix —
but always verify against `src/game/tuning.ts` for exact live numbers.

## Concept

Active incremental breeding & collection game: breed apples, choose which
offspring to keep, grow saved varieties in owned Fields, harvest for cash,
respond to a scripted Week-1 calendar of markets/contests, expand farmland,
and fill out a Collection across generations.

## Rendering resolution

The game is authored natively at **1600x900** (`LAYOUT.width/height` in
`src/game/ui/theme.ts`) — every screen's coordinates are literal values in
that space, not a smaller canvas stretched or zoomed up. `Phaser.Scale.FIT`
still handles responsive CSS scaling down to embed sizes exactly as before;
only the raster buffer got bigger, so text/apples/panels stay sharp instead
of being upscaled from a smaller buffer. There is no camera zoom and no
runtime/dynamic resize logic anywhere — a prior dynamic-resize + camera-zoom
experiment caused a blank-scene regression and was reverted; don't
reintroduce that pattern. If more resolution is ever needed, scale the
`LAYOUT` constants and each screen's literal coordinates again the same way,
rather than adding a runtime scale/zoom layer.

## Screens

Four persistent-bottom-nav screens: **ORCHARD**, **BREED**, **CALENDAR**,
**COLLECTION**, plus a top HUD (day, timer, cash, market highlight, next
event, END DAY button). Nav tabs show a small red dot when a screen has a
pending useful action (harvest ready, breeding result ready, unseen trait
discovery).

## Orchard

- Up to 4 Fields, one variety each, selected via horizontal tabs (`+ FIELD`
  tab to buy the next one).
- Each Field view renders 5 procedural trees (3 front row, dominant; 2 back
  row, smaller/higher) with a triangle of 3 fruit slots each — 15 physical
  fruit slots total per Field, though not all are necessarily *active* (see
  Yield below). There is **no whole-field growth cycle** — each active slot
  regrows completely independently (`Field.slots`, an array of
  `{ ripe, timer, active }`), ticked every frame in `Game.update()`
  regardless of which field tab is selected or whether the day is active.
  Harvesting one apple only resets that slot's own timer; the other slots
  keep doing whatever they were already doing. Inactive slots never tick,
  never ripen, and are never harvestable. Regrow duration is driven by the
  planted variety's genetic **Growth** stat (see Genetic Traits below) with
  ±20% per-roll variance, shortened by Irrigation the same way the old
  global cycle was. A freshly planted/purchased field's active slots start
  staggered (`makeInitialFruitSlots()`): some already ripe (Field 1 starts
  ~60% grown, newly purchased Fields ~50%), the rest with regrow timers
  spread across the window instead of all sharing one value, so fruit don't
  all pop in sync.
- Each fruit slot plays the same ~0.5s pop-in reveal animation the moment
  its own timer completes, independent of every other slot.
- Apples are directly harvestable: click one, or press-and-hold anywhere and
  drag over ripe fruit to sweep-harvest. Each individual harvest gives
  lightweight pop feedback immediately (no waiting). **Temporary economy
  bridge** (until a real Shipping system replaces it): individually
  harvested fruit accumulate on `field.harvestedSinceReward`; every 15
  (`TUNING.FRUIT_PER_BATCH`, matching the 15 physical slots) triggers the
  existing single field-harvest cash reward exactly once, then the counter
  resets — never multiplied per fruit, and not gated on all 15 being ripe
  at once. This counter isn't surfaced prominently in the UI.
- **HARVEST ALL** is a small secondary button (~200×56px, gold when
  anything is ripe) that collects whatever fruit are *currently* ripe —
  zero, some, or all 15 — contributing normally toward the same batch
  counter above. It never requires the full crop to be ripe first.
- Switching Field tabs preserves each field's independent per-slot state
  exactly (ripe/growing, remaining timer, current visibility) — the shared
  set of 15 tree visuals just snaps to match whichever field is now
  selected, instead of replaying growth or losing already-harvested fruit.
- Apple color/pattern/size reflect the planted variety's genetics (+
  cultivation size bonus); which of the 10 illustrations is shown is the
  variety's `visualId` (see Visual Rarity below). Tree count/position/motion
  is presentation-only.
- Cultivation policy (NORMAL / SWEETEN / GROW_BIG) changes apply immediately
  if nothing has been collected yet toward the field's current reward batch;
  otherwise they're queued and take effect starting with the **next**
  batch's harvest.

## Genetic Traits & Radar Chart

Every Variety has five genetic stats, all 0..100, persisted, inherited
through breeding, and drawn on a reusable 5-axis radar chart
(`ui/RadarChart.ts`) in that same fixed order — Sweetness, Size, Yield,
Growth, Freshness:

- **Sweetness** and **Size** directly set an apple's base sale price (see
  Economy below); Size also drives the apple's visual scale (0.90x at 0,
  1.00x at 50, 1.10x at 100 — `render/AppleVisual.ts` `sizeToVisualScale()`).
- **Yield** sets how many of a field's 15 physical fruit slots are
  simultaneously *productive* (ripe or regrowing): `9 + round(Yield * 6 /
  100)`, so 9/15 at Yield 0 up to 15/15 at Yield 100. It no longer
  multiplies harvest quantity directly — its production advantage is
  "more simultaneously productive slots, more batches over time." The
  productive *count* is fixed at that capacity, but *which* 15 physical
  positions hold it is not — a fresh field starts with a deterministic,
  evenly-distributed layout (`systems/economy.ts` `activeSlotIndices()`,
  seeded from the variety's own id, every tree gets at least one slot),
  and every harvest rotates exactly one productive slot out (the one just
  picked) and one dormant slot in (`pickNextProductiveSlot()` — prefers a
  genuinely different physical slot, and prefers whichever tree currently
  has the fewest productive slots), so no physical position stays
  permanently dark below Yield 100; over enough harvests every position
  gets a turn. Cultivation policy never touches Yield, so it never affects
  productive-slot count.
- **Growth** sets mean fruit-slot regrow speed: `12.0 - Growth * 0.04`
  seconds (12s at 0, 10s at 50, 8s at 100), then each individual regrow
  rolls ±20% around that mean, then Irrigation shortens it further as
  before (`systems/economy.ts` `fruitRegrowSeconds()`).
- **Freshness** exists genetically and shows on the radar chart, but has
  **no gameplay/economy effect yet** — reserved for a future
  Shipping-basket decay mechanic once Shipping's own timing is designed.
- No total/power score is ever shown to the player — only the five actual
  traits and the radar shape.

The radar chart is integrated into the Breed offspring-candidate cards, the
Library Picker's compact cards, its detail panel, and the Breed screen's
large Parent A/B cards. `RadarChart` takes an optional `showLabels` param
(default true, unchanged from its original single use) so compact contexts
can omit the five axis-name labels without a second component.

## Library (Owned Lines) & Parent Selection

"Library" is `GameState.library: Variety[]` — the same array that already
held kept breeding results; this pass didn't restructure it, just enriched
each entry and built proper browsing/selection UI around it. A `Variety`
here is an **Owned Line**: one specific breeding result the player chose to
KEEP, with its own genetics/generation, reusable indefinitely as a
breeding parent (selecting it never consumes, spends, duplicates, or
mutates it). This is distinct from the not-yet-built "Visual Variety"
concept (an eventual fixed official name per `visualId`, Collection-level)
— a Line's `customName` (renamed from the old `name` field) is a per-line,
currently auto-generated label, not that future official name. Rarity is
never stored on a Line — always derived from `visualId` via `APPLE_RARITY`.

- `favorite: boolean` and `archived: boolean` on every Line. Favorite never
  affects genetics or breeding odds. Archived Lines are excluded from the
  normal Parent Picker (Favorites/Recent/All) but are never deleted —
  `Game.setLineArchived()` is a minimal, reversible toggle; there is no
  destructive-delete or full archive-management UI yet.
- `GameState.recentParentIds: string[]` — up to the 6 most-recently-used-
  as-parent Line ids, most recent first, deduped (`Game.startBreeding()`
  records both parents; a self-cross records the one id once). Persisted
  with the rest of GameState (trivial to keep, so it wasn't worth the
  session-only shortcut the pass explicitly allowed as a fallback).
- **Library Picker** (`ui/LibraryPicker.ts`, opened via `openLibraryPicker`)
  is a reusable modal: FAVORITES / RECENT / ALL tabs, one sort control
  (Recent / Gen / Sweetness / Size / Yield / Growth / Freshness, stat
  modes default high→low, one ascending/descending toggle button), a
  paginated 2x2 compact-card grid (`ui/LineCard.ts`, mini unlabeled radar),
  and a detail panel (`ui/LineDetail.ts`, larger labeled radar + the exact
  five stat numbers) with an explicit CTA that is the *only* thing that
  commits a selection — clicking a grid card only previews it. Built to be
  reused by REPLANT and a future full Library screen, not just Breed.
- **Line cards** (`ui/LineCard.ts`, used for both the picker's compact grid
  and the Breed screen's large Parent A/B cards) show a top-left catalog
  label instead of the raw technical visualId — `"COMMON · #001"` etc, via
  a UI-only stable display index (`render/appleAssets.ts`
  `APPLE_CATALOG_NUMBER`/`catalogLabel()`, C1..E2 → #001..#010; never used
  for save data or rarity odds) — freeing vertical space for a visibly
  larger RadarChart underneath. Favorite star stays top-right.
- **Breed screen** now shows large Parent A/B cards (`LineCard` again, same
  component, bigger size params) showing only image/customName/visual-
  variety id/rarity/Gen/mini RadarChart — never the exact five numbers
  (that's what the picker's detail panel is for). Clicking a card (filled
  or empty) opens the picker in the matching "SELECT PARENT A/B" mode; a
  small ⇄ button swaps the two selections (matters because offspring A is
  Parent-A-biased and B is Parent-B-biased). Self-cross (same Line for both
  parents) is explicitly allowed — the picker never filters out a Line
  just because it's already selected as the other parent.

## Breeding

- One breeding process at a time. First breeding is free, ~6s. Every
  breeding after costs $35, ~18s.
- Every breeding produces exactly 4 offspring candidates (A/B/C/D), each
  inheriting all five genetic traits directly in raw stat units (not a
  normalized-weight system):
  - **A**: `ParentA*0.70 + ParentB*0.30` per trait, plus small (±3) noise.
    Generally recognizably Parent-A-like.
  - **B**: mirrors A — `ParentA*0.30 + ParentB*0.70` plus small (±3) noise.
  - **C**: starts at a 50/50 blend (±5 noise), then an explicit tradeoff
    twist boosts 1-2 randomly chosen traits by ~6-12 points combined and
    reduces 1-2 different traits by a comparable amount — a deliberate
    specialization, not just a flat average.
  - **D** is the wildcard: for *each* trait independently, picks whichever
    parent is the inheritance source (50/50), then applies a substantially
    larger mutation (±5-18 points). Highest variance of the four, but never
    simply "the strongest candidate."
- **Genetic Budget** (hidden, never shown to the player — the same
  hidden-potential/tradeoff mechanism from the original 3-stat design,
  adapted to all five traits): each candidate's own five-stat total is
  nudged toward the two parents' average total by a small, slot-specific
  delta (A/B: -2..+3, C: -3..+5, D: -8..+8), hard-capped at 360, individual
  stats clamped 0..100. This keeps breeding from becoming "every stat goes
  up every time" while still allowing gradual long-term improvement. See
  `systems/breeding.ts` `generateStats()`/`applyBudgetTarget()`.
- Visual traits (Color/Pattern) inherit from a parent with high probability;
  each slot has its own mutation chance (A/B low, C a little higher, D
  meaningfully higher) that can introduce an unseen trait. Entirely separate
  from the five numeric genetic traits and from Visual Rarity below.
- **KEEP exactly ONE** offspring into the permanent Library as a new Owned
  Line (`favorite`/`archived` both start false). Traits discovered by *any*
  of the 4 candidates are added to the Collection even if that candidate
  isn't kept — discovery and keep are independent.
- Scripted Week-1 moments (see `systems/breeding.ts`):
  - Day 1, first-ever breeding: guarantees a Yellow discovery opportunity if
    Yellow is undiscovered.
  - Day 5, first breeding of the day: guarantees one offspring shows Purple
    **or** Striped (whichever is undiscovered; picks one, not both).

### Result screen / KEEP flow

All four candidates render simultaneously (`ui/BreedScreen.ts`
`renderOffspringComparison`) — no paging. Each card shows only a top-left
catalog label, its A/B/C/D title + role ("PARENT A TYPE" / "PARENT B TYPE"
/ "RECOMBINED" / "WILDCARD"), a large apple, Gen, and a large labeled
RadarChart; clicking a card only selects/previews it (highlighted border)
and never commits — only the selected candidate gets an exact five-stat +
delta-from-parent-genetic-average readout (`(parentA+parentB)/2`, genetic
values only, never cultivation-adjusted), and the KEEP button is absent
until something is selected.

DISCOVERED vs OWNED are tracked from two different, already-existing
sources rather than new state: DISCOVERED already happens the moment
breeding resolves (`Game.resolveBreeding()` — unchanged from Pass 1), so
each frozen `OffspringCandidate.isNewVisualId` flag *is* "newly discovered
by this result," stable across reloads/UI rebuilds since it's baked into
the persisted offspring array at generation time, never recomputed.
OWNED is derived on demand (`Game.isVisualIdOwned()`) as "the Library
contains ≥1 Line with this visualId" — never stored separately. A subtle
non-blocking line near KEEP warns if a Rare/Epic candidate in this result
is unowned and would stay that way with the current selection (or with
nothing selected); it never fires for Common, never blocks KEEP, and
disappears once that exact candidate is the one selected.

`Game.keepOffspring(slot)` returns the created Line (or `null` — already
idempotent via the existing `breeding.ready`/`breeding.offspring` guard,
so a rapid double-click can't insert two Lines) and is the single
insertion point; the other three candidates are discarded (never entered
into the Library) but whatever they discovered stays discovered. The
post-KEEP screen (`renderPostKeep`) shows the kept apple, `customName`,
catalog label, Gen, and up to two conditional badges — NEW DISCOVERY
(`chosen.isNewVisualId`) and FIRST OWNED (`!wasOwnedBefore`, captured
*before* the Line is inserted, since inserting it would trivially make the
check always true afterward) — then RENAME/CONTINUE. RENAME swaps those
buttons for SAVE/CANCEL and opens a temporary DOM `<input>` positioned
over the customName text (scaled from game to CSS coordinates via the
canvas's own bounding rect, so it tracks Scale.FIT correctly); it edits
only `customName` (trim, cap ~24 chars, reject empty-after-trim, full
Unicode/Japanese support for free since it's a real DOM input) and is
always torn down — including automatically if the player switches away to
another bottom-nav tab mid-rename. CONTINUE just clears the transient
post-keep UI state; Parent A/B selections are untouched (BreedScreen's own
fields, never read by the KEEP flow), so it returns to Breed setup exactly
as the player left it — no auto-plant/favorite/re-select/re-breed.

## Visual Rarity (Common/Rare/Epic)

Separate from — and additive to — the genetic Sweetness/Size/Yield/Color/
Pattern system above. Every offspring candidate (A/B/C/D) also gets a
`visualId` picked from 10 painterly illustrations, rolled once at breeding
time in `systems/rarity.ts` and stored permanently on the kept `Variety`.
The 15 Orchard fruit slots are harvest presentation only and do not roll
rarity themselves — they always show the planted variety's own `visualId`.

- Only three tiers exist: **Common** (C1-C4), **Rare** (R1-R4), **Epic**
  (E1-E2). No Uncommon or Legendary tier.
- Day-gated unlock: C1/C2 from Day 1, C3 from Day 2, C4 from Day 3, Rare
  from Day 4, Epic from Day 6. Before its day, an ID has exactly zero
  natural appearance chance (probability mass renormalizes into Common).
- Base Rare/Epic odds once unlocked — A/B/C: 1.20% Rare, 0.06% Epic each;
  D (wildcard): 2.40% Rare, 0.18% Epic (always 2x A/B/C).
- On a Common result, there's a small chance (6% for A/B/C, 15% for D) to
  surface an unlocked-but-not-yet-discovered Common ID instead of the usual
  parent-resemblance pick; otherwise a Common result usually matches one of
  the two parents' own Common visuals (same A/B/C/D resemblance bias as the
  genetic traits).
- On a Rare/Epic result, the specific ID is picked from the currently
  unlocked pool with undiscovered IDs weighted 2x over already-discovered
  ones — a soft nudge toward new content, not a duplicate-protection
  guarantee.
- Old saves from before this system get a safe `C1` backfill for any
  missing `visualId`/`discoveredVisualIds` (see `systems/save.ts`); no
  crash, no forced re-roll.

## Economy

Each temporary settlement batch (see Orchard above) represents exactly
`TUNING.FRUIT_PER_BATCH` (15) apples — quantity is fixed, not
Yield-derived, since Yield's production advantage is active-slot count
instead (more batches produced over time, not a bigger one):

```
value per apple  = 2.00 + EffectiveSweetness * 0.010 + EffectiveSize * 0.005
revenue          = 15 * value per apple * marketMultiplier * shippingMultiplier
marketMultiplier = clamp(1 + colorModifier + patternModifier, ..., 1.6)
```

Only Sweetness and Size affect price. Rarity (Common/Rare/Epic) is a
separate visual/discovery concept and never multiplies price directly — a
strong Common can outsell a weak Epic.

Daily expenses at END DAY: `$15 + $20 per owned Field`.

Cultivation modifiers (SWEETEN/GROW_BIG) only affect *effective*
Sweetness/Size used for harvest value and contest scoring — genetic stats
used for breeding are never touched, and cultivation never affects Yield's
active-slot count or harvest quantity (quantity is fixed at 15 per batch).

## Farmland & Upgrades

- Field 2: $300 (purchasable from Day 2). Field 3: $850. Field 4: $1800.
  Each requires the previous Field already owned.
- Irrigation: $250 then $700, −12% fruit-slot regrow time per level, max 2.
- Shipping: $400 then $1000, +10% sale value per level, max 2.
- No upgrade ever raises genetic Sweetness/Size/Yield directly — that's
  breeding's job only.

## Calendar (Week 1, scripted)

| Day | Event |
|---|---|
| 1 | First harvest, first (free) breeding, Yellow discovery opportunity |
| 2 | Yellow market +30%; Field 2 becomes purchasable |
| 3 | Flavor text previews the Day 4 contest |
| 4 | **Sweetness Contest** — submit a planted variety; benchmarks 65/72/79 → $80/$180/$350 |
| 5 | Mutation day — first breeding guarantees Purple or Striped |
| 6 | Purple +40%, Striped +25% market event |
| 7 | **Apple Fair** — composite score (sweetness/size/rarity); benchmarks 35/50/65 → $90/$200/$400, then Week 1 Complete summary |

One game Day ≈ 90 seconds of active time. At 0, growth cycles already in
progress finish naturally but no *new* cycle starts, and no new breeding can
begin; ready harvests/offspring can still be collected/resolved, and END DAY
becomes available.

END DAY sets `GameState.dayEnded=true` and shows a summary modal; only
that modal's own "NEXT DAY →" button calls `proceedToNextDay()`, which
resets `dayEnded` and advances the day (or, on Day 7, sets `weekComplete`
and waits for the Week Summary modal's own continue button before actually
advancing — `weekComplete` stays true and `dayEnded` stays true across that
gap too). Both `dayEnded` and `weekComplete` are persisted GameState, but
the summary modals that gate proceeding past them are transient UI only
ever triggered by the END DAY click handler — a reload landing between
"day ended" and "modal button clicked" used to leave the player stuck with
a permanently-disabled END DAY button and no code path that could ever
show the modal again. `MainScene.create()` now checks for this on load and
re-enters the same flow (reusing the persisted `lastDayLog`) so the modal
always reappears and the game is never trapped. `Game.endDay()` itself
already no-ops on a second call (`canEndDay()` requires `!dayEnded`), so
double-clicking END DAY was never able to double-charge expenses.

## Persistence

Entire `GameState` is JSON-serialized to `localStorage` under one key
(`TUNING.SAVE_KEY`), autosaved roughly every 120ms while the tab is open and
on `beforeunload`. RESET PROTOTYPE (in the debug panel) clears the save and
returns to the Day 1 starter state. `systems/save.ts` `migrateState()`
backfills fields missing from older saves rather than crashing on load:
visualId/discoveredVisualIds, per-slot `active` flags, `growth`/`freshness`
on any Variety that predates the five-trait system (defaulted to 50
without touching existing Sweetness/Size/Yield), and — since the Library
pass — `customName` (from the old `name` field), `favorite`/`archived`
(both default false), and `recentParentIds` (default `[]`). A save with no
Library at all gets seeded with the same two starting Lines a brand-new
game gets (`systems/starterLines.ts`, shared by both `Game.ts` and
`save.ts` to avoid a circular import) rather than being left unplayable.
`Game.ts`/`save.ts` always insert *fresh copies* of the two starters
(`freshStarterLines()`, own `awards` array) into a live GameState, never
the module-level singleton objects directly — Library entries get mutated
in place (e.g. contest awards), and pushing the singleton itself would let
that mutation leak into every future `resetPrototype()` within the same
page session. The very old (pre-visual-rarity) per-variety `visualId`
backfill is narrowly targeted by the starter's own stable id
(`variety.id === 'starter-green' ? 'C2' : 'C1'`) rather than blanket-
defaulting every missing visualId to `'C1'` — the blanket version was the
root cause of a real bug where GREEN BASIC could load showing the red C1
apple; a bred Line never has this id (bred Lines get a fresh
`crypto.randomUUID()`) so the narrow check can't misfire onto one.

## Deliberate deviations from the original spec

- Since the Orchard pass replaced the single whole-field growth cycle with
  15 independent per-slot regrowth timers, the old day-end growth freeze (a
  field at 0% growth wouldn't start a new cycle after the day ended) no
  longer has a clean per-field equivalent and was dropped: fruit slots now
  regrow continuously regardless of day state. This matches the pass's
  explicit goal of a continuously living orchard; day-length/clock rules
  themselves are unchanged and out of scope for that pass.

Offspring resolution is intentionally forced: the player must KEEP exactly
one of the four candidates (no discard/reroll option). This is a core
playtest hypothesis, not a soft-lock — a candidate can always be kept and
breeding continues normally afterward.
