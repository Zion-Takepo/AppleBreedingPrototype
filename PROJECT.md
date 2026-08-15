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
  lightweight pop feedback immediately (no waiting). Harvesting itself
  **never awards cash directly** — see Shipping Pipeline below.
- **HARVEST ALL** is a small secondary button (~200×56px, gold when
  anything is ripe) that collects whatever fruit are *currently* ripe —
  zero, some, or all 15 — feeding the exact same Shipping Pipeline as
  individual harvest. It never requires the full crop to be ripe first.
- Switching Field tabs preserves each field's independent per-slot state
  exactly (ripe/growing, remaining timer, current visibility) — the shared
  set of 15 tree visuals just snaps to match whichever field is now
  selected, instead of replaying growth or losing already-harvested fruit.
- Apple color/pattern/size reflect the planted variety's genetics (+
  cultivation size bonus); which of the 10 illustrations is shown is the
  variety's `visualId` (see Visual Rarity below). Tree count/position/motion
  is presentation-only.
- Occasionally one fruit slot shows a visibly different apple than the rest
  of the field — a physical Breeding Specimen the player can harvest as
  one-use Breed material rather than ordinary fruit; see "Orchard Mutation
  / Breeding Specimen" below.
- Cultivation policy (NORMAL / SWEETEN / GROW_BIG) changes apply
  immediately — since each apple's price is now locked in individually at
  the moment it's harvested (see Shipping Pipeline below), a policy change
  simply applies to whichever fruit is harvested next; there is no batch
  boundary left to defer it across.

## Shipping Pipeline

Harvesting (individual click/sweep or HARVEST ALL — both feed the identical
path) never awards cash directly. Instead each harvested apple is priced
immediately — locking in that field's *current* cultivation policy plus the
*current* market/shipping multipliers into the apple's own record, so later
changes to cultivation, variety, or market never retroactively reprice an
apple already in the pipeline — and pushed onto **one shared, farm-wide**
processing queue (`GameState.processingQueue`, an array of
`{ fieldId, value, baseValue }`; NOT one queue per Field — buying another
Field raises production but never speeds up the shared shipping line, which
preserves it as a deliberate future bottleneck for Freshness/processing
upgrades). Only the queue's head item has an active timer
(`GameState.processingTimer`); ticked every frame in `Game.update()`
regardless of day state, matching the Orchard's own continuous-regrow
policy. `value`/`baseValue` are exact, **unrounded** dollar amounts —
rounding every individual apple to a whole dollar would swamp small
Sweetness/Size differences (a $2-4 per-apple range quantized to $1 steps),
so the queue, `cash`, and `totalRevenue` all carry full fractional
precision; both `cash` (HUD) and every shipment's own feedback display it
rounded to exactly two decimal places (`$50.00`, `+$2.75`) rather than a
whole dollar. Every `TUNING.PROCESSING_SECONDS_PER_APPLE` (1.0s) seconds,
the head ships automatically: its value pays into `cash`/`totalRevenue`
unconditionally (that money was genuinely earned at harvest time), while
`baseValue` only adds into `dayHarvestRevenue`/`dayMarketBonus` while
`!GameState.dayEnded` — once END DAY has settled the current day's summary
snapshot, further shipments still pay cash but stop feeding those two
day-scoped counters, so leftover queue items draining after settlement
can't silently inflate or attribute revenue to a day whose summary was
already shown (the queue itself keeps draining unconditionally either way —
this settlement guard is the only day-state-aware behavior in the Shipping
Pipeline). A `'shipment'` event fires with the originating fieldId
regardless of day state, and the next item begins processing. The HUD
(`ui/HUD.ts`) listens for every `'shipment'` event — always, since the HUD
itself is always visible regardless of which bottom-nav screen is active,
and never filtered to a selected Field since the queue is shared farm-wide
— to show a compact "+$" feedback directly under the cash total (a single
reused Text that drifts lightly upward and fades, never a stacked list),
paired with a small scale pulse on the cash total itself. HUD cash also
updates through its normal periodic refresh, so cash visibly rises in small
increments as apples ship rather than jumping in a lump sum. The temporary
shipment-box placeholder (bottom-right of the Orchard view, not yet
redesigned) shows a live farm-wide queue count for playtesting. Freshness-
based queue-time depreciation is intentionally not part of this pass.

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
- **Breed is a strategic pause**: while BREED is the active main screen
  (parent selection, the LINES/SPECIMENS picker, Line/Specimen detail, the
  stat-help modal, offspring comparison, KEEP/post-Breed UI — every one of
  these is either rendered directly inside `BreedScreen`'s own content or
  as a modal that blocks input to the rest of the scene while open, so
  gating on "is BREED the active screen" alone already covers all of
  them), the farm/day **simulation** is frozen — the digital day clock,
  fruit growth/ripening, Specimen appearance rolls, the shipping queue,
  and shipment cash all stop advancing. An in-progress Breed operation's
  own countdown is deliberately NOT part of that freeze — it keeps
  advancing and resolving even if the player stays on the BREED screen the
  entire time, so parking there to "watch it brew" works exactly as it
  always has. Implemented via `Game.update(dtSeconds, pauseFarmSimulation)`
  — `scenes/MainScene.ts`'s `isBreedPauseActive()` is evaluated every
  frame and passed straight through as that second argument, so
  `Game.update()` itself is always called; only the farm/day-simulation
  block inside it is conditionally skipped, while the breeding-timer block
  runs unconditionally. Not a broad Phaser scene pause, and no persisted
  pause flag, since the condition is purely derived from existing
  (already-transient) `activeScreen`/day state each frame. Deliberately
  NOT active while Closing is already in progress or the day has already
  ended, so merely being on the BREED tab can never suspend an
  already-started settlement flow. Because the farm/day simulation simply
  isn't advanced while paused, there is no catch-up delta for it — leaving
  BREED resumes farm time from the exact prior simulated moment. A small,
  secondary `TIME PAUSED` label appears on every Breed sub-screen while
  the pause is genuinely active (it describes the farm/day freeze, not the
  breeding countdown, which the hint text on the in-progress screen
  clarifies separately).
- Either parent slot can be a permanent Library Line **or** a held
  Breeding Specimen (see "Orchard Mutation / Breeding Specimen" below) —
  Line×Line (including self-cross), Line×Specimen, Specimen×Line, and
  Specimen×Specimen (including two different Specimens sharing the same
  Visual) are all allowed; the same Specimen id can never occupy both
  slots. A Specimen parent participates in the five-stat inheritance below
  using its own five stats exactly like a normal genetic parent, and its
  `sourceGeneration` stands in for `generation`; its Color/Pattern (needed
  only for the legacy genetic-trait mutation system, see below) are
  borrowed from its own source Line, since a Specimen doesn't persist
  those itself. A Specimen parent is **consumed** — removed from the held
  inventory — the instant BREED is confirmed/started (not on KEEP), so
  reusing a rare find requires finding another one; a Library Line parent
  is never consumed.
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
- **TOTAL progression / Genetic Budget** (hidden budget mechanism, never
  shown to the player as a number — revised so breeding always feels like
  genuine advancement): `TOTAL = Sweetness+Size+Yield+Growth+Freshness`.
  Every Breed operation rolls exactly ONE shared improvement,
  `TUNING.BREED_IMPROVEMENT_MIN..MAX` (+2..+6), applied to the **stronger**
  parent's own TOTAL: `breedTargetTotal = min(360,
  max(parentATotal, parentBTotal) + improvement)`. ALL FOUR candidates
  (A/B/C/D) are then rescaled to this exact same shared target via
  `systems/breeding.ts` `scaleToBudget()` — never four independent rolls —
  so the player's choice among them is always about stat
  distribution/specialization/Visual/risk, never "which one happened to
  roll the bigger total." If the stronger parent is already at the 360
  cap, `breedTargetTotal` stays exactly 360 (the one allowed exception to
  "Breed always increases TOTAL") — breeding still freely redistributes
  the five stats. Individual stats stay clamped 0..100. See
  `systems/breeding.ts` `generateStats()`/`breedOffspring()`. The result
  screen (below) shows this as a compact `TOTAL 267 → 272 (+5)` line,
  identical on all four candidate cards since they share the target.
- Visual traits (Color/Pattern) inherit from a parent with high probability;
  each slot has its own mutation chance (A/B low, C a little higher, D
  meaningfully higher) that can introduce an unseen trait. Entirely separate
  from the five numeric genetic traits and from Visual Rarity/Visual
  inheritance below.
- **Visual (`visualId` + `baseVisualId`) inheritance** (replaced the old
  independent per-candidate rarity roll — see `systems/breeding.ts`
  `pickCandidateVisualPair()`):
  - **A** always shows Parent A's exact Visual; **B** always shows Parent
    B's exact Visual — both 100% guaranteed, no mutation possible. This is
    what guarantees a hard-won rare Specimen used as a parent can never
    lose its Visual across all four candidates: at minimum, its matching
    A or B candidate always preserves it.
  - **C** is Parent A's or Parent B's Visual, 50/50 — recombination only,
    never a mutation.
  - **D** normally inherits Parent A's or Parent B's Visual 50/50, but has
    a `TUNING.SPECIMEN_D_VISUAL_MUTATION_CHANCE` (10%) chance to instead
    roll a mutated Visual **Common-only** (#001-#004, respecting the
    existing Day-1-only-#001/#002 onboarding gate, Day 2+ all four),
    undiscovered-weighted 2x, falling back to ordinary 50/50 inheritance
    if no valid alternate Visual exists. Revised: Rare/Epic can no longer
    be spontaneously created by breeding **at all**, on any day — A/B/C/D
    together can never introduce a new Rare/Epic Visual. The only route
    for a new Rare/Epic Visual is a physical Orchard Specimen (see
    "Orchard Mutation / Breeding Specimen" below and its Mutation
    Affinity).
  - Whenever a candidate inherits a parent's `visualId`, it always
    inherits that SAME parent's `baseVisualId` too (see "Orchard Mutation
    / Breeding Specimen" below) — never mixed. A candidate D Common
    mutation always sets `baseVisualId` equal to its own new `visualId`
    (a freshly found stable cultivar).
- **Five-stat info button**: a small circular "i" button (top-right, same
  position on both the parent-selection and offspring-result screens)
  opens a shared, reusable, large readable modal/panel
  (`ui/StatHelpModal.ts` `openStatHelpModal()`) explaining what each of
  the five genetic stats actually does in plain English — Sweetness/Size
  affect value, Yield affects active-slot count, Growth affects regrow
  speed, and Freshness is explicitly described as not yet affecting
  economy (reserved for a future Shipping-decay mechanic). Same close
  behavior as every other modal (X button only — no outside-click-close
  exists anywhere in this codebase, so this doesn't invent one).
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
/ "RECOMBINED" / "WILDCARD"), a large apple, Gen, a compact secondary
`TOTAL 267 → 272 (+5)` progression line (identical on all four cards —
see Breeding's TOTAL progression bullet above; `BreedScreen.ts`
`formatTotalLine()`, sourced from `BreedingState.strongerParentTotal`/
`breedTargetTotal`, persisted by `Game.resolveBreeding()` specifically so
this survives a reload), and a large labeled RadarChart; clicking a card
only selects/previews it (highlighted border)
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
`visualId` picked from 10 painterly illustrations (see Breeding's Visual
inheritance subsection above) and stored permanently on the kept `Variety`.
An ordinary Orchard fruit slot is harvest presentation only and always
shows the planted variety's own `visualId` — except when it's holding a
special mutation fruit (a Breeding Specimen), which shows that Specimen's
own, different `visualId` instead; see "Orchard Mutation / Breeding
Specimen" below.

- Only three tiers exist: **Common** (C1-C4), **Rare** (R1-R4), **Epic**
  (E1-E2). No Uncommon or Legendary tier.
- Day-gated unlock: C1/C2 from Day 1, C3 from Day 2, C4 from Day 3, Rare
  from Day 4, Epic from Day 6. Before its day, an ID has exactly zero
  natural appearance chance (probability mass renormalizes into Common) —
  this table is shared by both the Orchard Specimen system and Breed's
  Candidate D mutation below.
- Old saves from before this system get a safe `C1` backfill for any
  missing `visualId`/`discoveredVisualIds` (see `systems/save.ts`); no
  crash, no forced re-roll.
- **Breed's per-candidate Visual assignment** no longer rolls
  independently per offspring — see Breeding's "Visual inheritance"
  subsection below, which replaced it as part of the Orchard Mutation /
  Breeding Specimen pass. Naturally-occurring Rare/Epic Visuals are now
  mainly found as physical Orchard Specimens (see "Orchard Mutation /
  Breeding Specimen" below) rather than rolled during breeding.

## Orchard Mutation / Breeding Specimen

Connects Orchard harvesting to Breed: occasionally an Orchard fruit slot
visibly shows a different Visual Variety than the field's planted Line —
"I personally found an unusual apple on this tree." Harvesting it gives a
tangible, **one-use Breeding Specimen** (`GameState.specimens`,
`systems/specimen.ts`) rather than shipping revenue. A Specimen can be
selected directly as a Breed parent (see Breeding above) and is consumed
the instant BREED starts; if the resulting offspring is KEPT, the find has
become a permanent Owned Line. Three distinct states now exist:

- **DISCOVERED** — the Visual Variety has been seen (Market/Collection-
  eligible); doesn't imply ownership.
- **SPECIMEN** — a specific individual special apple physically held by
  the player: its own Visual and its own five genetic stats, one-use,
  never added to the Library.
- **OWNED LINE** — unchanged: a permanent Library Line, normally created
  by KEEPing offspring.

Every Line and Specimen also carries a **`baseVisualId`** alongside its
identity `visualId` (see "Stable Common baseVisual / Mutation Affinity"
below) — `visualId` is what it *is* (its special lineage/identity, shown
in the Library/Market/Collection), `baseVisualId` is the Common Visual it
*stably produces* as ordinary Orchard fruit. For a Common Visual the two
are always identical; a Rare/Epic Line/Specimen's `baseVisualId` is always
a Common id.

**Specimen shape** (`BreedingSpecimen`, `types.ts`): `id`, `visualId`,
`baseVisualId`, the five genetic stats
(`sweetness`/`size`/`yieldStat`/`growth`/`freshness`), `foundDay`,
`sourceLineId`, `sourceGeneration`. Never added to `GameState.library`,
never given a permanent name, never shown with its raw `C1`/`R1`/`E1` id
(always the catalog label).

**Fruit-slot representation**: `FieldFruitSlot.specimen: BreedingSpecimen
| null`. Generated the instant a fruit slot **becomes ripe** (whether via
its own regrow timer or a guaranteed onboarding spawn), never later at
harvest time — this is what makes save/reload unable to reroll it. A
non-null `specimen` on a ripe slot makes `OrchardTreeLayer` show that
Specimen's own `visualId`/`size` on that one physical apple instead of the
field's planted Line's ordinary `baseVisualId`, reverting once it's
harvested/regrown as ordinary fruit (`render/OrchardTreeLayer.ts`
`sync()`).

**Guaranteed onboarding specimens** (`Game.maybeSpawnGuaranteedSpecimen`,
gated by the persisted `day1SpecimenGuaranteeUsed`/
`day2SpecimenGuaranteeUsed` flags so a reload/re-play can never duplicate
or re-trigger one):

- **Day 1** — exactly one **COMMON · #002** (`C2`), forced ripe
  immediately on a planted Field whose own Line visual isn't already `C2`
  when such a Field exists. Teaches the physical-specimen mechanic itself
  (`C2` may already be owned — that's intentional).
- **Day 2** — exactly one **COMMON · #003 or COMMON · #004**: whichever
  is still undiscovered if only one is; 50/50 otherwise. Deliberately
  supersedes `C4`'s normal Day 3 unlock gate (see Visual Rarity above) —
  this guarantee alone may reveal `C4` a day early.
- **Day 3 onward** — no more guaranteed drops; appearance becomes
  probability-based (below). No normal random roll ever happens on Day 1
  or Day 2.

**Day 3+ random appearance** (`Game.maybeGenerateRandomSpecimen` →
`systems/specimen.ts` `rollOrchardSpecimen`, rolled once per ordinary
fruit slot the instant it ripens — one mutually exclusive tier roll, so a
fruit can never become multiple tiers): Common `TUNING.SPECIMEN_COMMON_CHANCE`
(0.30%) from Day 3, Rare `SPECIMEN_RARE_CHANCE` (0.05%) from Day 4, Epic
`SPECIMEN_EPIC_CHANCE` (0.005%) from Day 6 — no daily cap, further boosted
for a planted Rare/Epic Line's own special Visual by its Mutation Affinity
(see below). The specific Visual is chosen from that day's unlocked tier
pool (Visual Rarity's table above), excluding the planted Line's ordinary
`baseVisualId` (so the player can actually notice it — this is literally
what the tree is otherwise showing, see "Ordinary fruit rendering /
selling" below) and undiscovered-weighted 2x; falls back to an ordinary
fruit if no valid alternate Visual exists rather than fabricating one.

### Stable Common baseVisual / Rare-Epic Line behavior

A Rare/Epic Specimen can still be bred and KEPT into a permanent Line —
but the player can no longer plant that Line and mass-produce Rare/Epic
fruit forever. Keeping a rare find captures its **special genetic
identity/lineage**, not an "infinite factory" for its Visual.

- **Common Lines (#001-#004) are stable cultivars**:
  `baseVisualId = visualId` always. Planting one produces that exact
  Visual continuously, unchanged from before this pass.
- **Rare/Epic Lines are unstable special traits**: `baseVisualId` is a
  Common id, inherited unchanged through breeding from whichever parent
  contributed the special `visualId` (see Breeding's Visual inheritance
  above — visual and base always travel together from the same parent,
  never mixed). Example: a `COMMON · #001` tree spontaneously produces one
  `EPIC · #009` Specimen — that Specimen has `visualId #009`,
  `baseVisualId #001`. If bred and KEPT, the resulting Line is identified
  in the Library as `EPIC · #009`, but planting it grows ordinary
  `COMMON · #001` fruit, not a tree full of `#009`. The Line instead gains
  a permanent **Mutation Affinity** for `#009` (below) — "I captured the
  #009 bloodline," not "I unlocked an infinite #009 factory."
- **Specimen `baseVisualId` at creation** (`Game.buildSpecimen` →
  `systems/specimen.ts` `deriveSpecimenBaseVisualId()`, set once and never
  re-derived): a **Common**-tier specimen's `baseVisualId` is its own
  fresh `visualId` (a newly found stable cultivar); a **Rare/Epic**-tier
  specimen's `baseVisualId` is inherited from the *planted source Line's
  own* `baseVisualId` — never the source Line's `visualId`. This is why a
  second-generation mutation (a Rare/Epic Line that itself sprouts another
  Rare/Epic Specimen) still traces back to the original Common ordinary
  fruit, not to the intermediate special Visual.
- **Mutation Affinity** (`systems/specimen.ts` `mutationAffinityFor`):
  a Rare Line's own special Visual gets `TUNING.RARE_MUTATION_AFFINITY_MULTIPLIER`
  (×10) recurrence affinity; an Epic Line's own special Visual gets
  `TUNING.EPIC_MUTATION_AFFINITY_MULTIPLIER` (×20). Applies **only** to
  that exact Visual — a `#009` Line does not boost `#010`, a `#005` Line
  does not boost `#006`/`#007`/`#008` — and never stacks by generation
  (the multiplier is a pure function of the Line's own `visualId` alone;
  breeding `#009` into itself repeatedly stays exactly ×20, never
  ×20→×400). Implemented as an ADDITIONAL independent per-ripening chance
  layered on top of (not replacing) the Visual's normal within-tier
  baseline share (`systems/specimen.ts` `affinityBonusChance` =
  `basePerSpecificChance(tier, day) * (multiplier - 1)`, where
  `basePerSpecificChance` ≈ tier's base chance ÷ number of visuals in that
  tier) — checked first, and only falls through to the ordinary
  mutually-exclusive tier roll if it doesn't fire, so one fruit still
  becomes at most one Specimen. This targets the matching Visual's
  ABSOLUTE occurrence rate at roughly `multiplier`× the non-affinity
  baseline (not merely its selection weight *after* a Rare/Epic tier
  already occurred) — e.g. Rare: ~0.0125% baseline + ~0.1125% bonus ≈
  0.125% total (10×); Epic: ~0.0025% baseline + ~0.0475% bonus ≈ 0.05%
  total (20×). Still respects the existing day gates — a Rare affinity
  cannot fire before Day 4, Epic before Day 6.
- **Ordinary fruit rendering / selling**: a planted Field always shows
  (and prices) its Line's `baseVisualId`, never `visualId`
  (`render/OrchardTreeLayer.ts` `sync()`; `systems/economy.ts`
  `priceHarvestedApple()` → `marketMultiplierForVisual(variety.baseVisualId, ...)`).
  A Rare/Epic Line's own Market price (keyed by its `visualId`) therefore
  has little/no direct sale usage yet in this pass — Rare/Epic Specimens
  are still automatically preserved for breeding, not shipped (see
  "Harvesting a Specimen" above); a sell-Specimen feature is explicitly
  out of scope. `ui/OrchardScreen.ts` shows a small "Growing: COMMON ·
  #001 (Special Lineage: EPIC · #009)" note whenever a planted Line's
  `visualId` differs from its `baseVisualId`, and `ui/LineDetail.ts`
  shows a similar "SPECIAL LINEAGE · #009 / Stable Fruit: COMMON · #001 /
  Mutation Affinity: ×20" block in the Library Picker's detail panel — no
  permanent Visual Variety names invented, no raw internal ids shown.
- **KEEP / ownership semantics are unchanged**: KEEPing a Rare/Epic
  offspring still makes that Visual **OWNED** (`Game.isVisualIdOwned()`
  still derives purely from `Library.some(v => v.visualId === id)`, keyed
  on identity `visualId`, never `baseVisualId`) — Market may still show it
  as OWNED. That's intentional: the Line owns the special genetic
  identity/affinity; its normal Orchard production is `baseVisualId`.
  Holding a Specimen alone (never KEPT into a Line) does NOT make its
  Visual OWNED.

**Specimen stat generation** (`systems/specimen.ts`
`generateSpecimenStats`) — a mutation of the Line it grew on, never five
unrelated random stats: start from the source Line's five stats, apply an
independent integer ±4 mutation to each, then one additional major
mutation (magnitude 8-12, random sign) to one randomly chosen stat, then
rescale to a hidden budget target of `sourceTotal + randInt(-3..+5)`
(capped 360, same absolute cap as breeding) via the exact
`scaleToBudget()` helper breeding's own candidates use
(`systems/breeding.ts`). Rarity of the Visual never buys a stat-budget
advantage — an Epic specimen can be genetically mediocre and a Common one
exceptional.

**Discovery timing**: a new Visual becomes DISCOVERED the moment the
special fruit **appears** (becomes ripe), not when harvested — added to
`discoveredVisualIds` and given a safe baseline/STABLE Market entry via
the same `Game.registerVisualDiscovery()` path breeding discovery also
uses now, with no extra random Market move on the discovery day (its
first real movement is the next daily Market update, same as always).

**Harvesting a Specimen**: removed from its fruit slot through the normal
harvest/rotation lifecycle (`Game.harvestFruitSlot`) — the ONE shared path
every harvest route (direct click/sweep, HARVEST ALL, Closing's automatic
ripe-fruit collection) already goes through, so all three preserve a
Specimen identically with no special-casing needed per route. It is added
to `GameState.specimens`, never queued for shipping, never paid as normal
sale revenue, and never rerolled — exactly the record generated when the
fruit appeared.

**Breed parent selection**: the Library Picker (`ui/LibraryPicker.ts`)
gained a `LINES | SPECIMENS` source switch; a Specimen card
(`ui/SpecimenCard.ts`)/detail panel (`ui/SpecimenDetail.ts`) shows its
apple image, catalog rarity/number, `SPECIMEN` badge, Found Day, a labeled
RadarChart, and a `ONE USE` reminder — no customName, no favorite star, no
Gen number (a Specimen has none of those). `GameState.recentParentIds`
still tracks Lines only. Selection is represented as a `BreedParentRef`
(`{ kind: 'LINE' | 'SPECIMEN', id }`) threaded through `Game.startBreeding`
and BreedScreen's Parent A/B state; the same Specimen id is excluded from
the other slot's picker (and BREED is disabled as a defense-in-depth
backstop) so it can never occupy both slots at once.

**Consumption**: a Specimen parent is removed from `GameState.specimens`
atomically inside `Game.startBreeding()`, the instant BREED is
confirmed — not later on KEEP, so a rare find can't be reused repeatedly
while fishing for a perfect candidate. Its full data is snapshotted onto
`BreedingState.parentA/BSpecimenSnapshot` at that same moment, since
`resolveBreeding()` runs later (once the timer elapses) and can no longer
look the by-then-consumed Specimen up by id — this snapshot is itself
persisted, so a reload mid-breeding still resolves correctly. No
refund/reroll mechanic exists.

**Save migration**: old saves backfill `specimens: []`,
`day1/day2SpecimenGuaranteeUsed: false`, per-slot `specimen: null`,
`BreedingState.parentA/BKind: 'LINE'` with null snapshots, and
`BreedingState.strongerParentTotal`/`breedTargetTotal: null`
(`systems/save.ts`). A save still on Day 1 or Day 2 with the guarantee not
yet recorded as spawned receives it once on load; a Day 3+ save never gets
a Day-1/Day-2 specimen fabricated retroactively. Every Line/Specimen
missing `baseVisualId` backfills it: Common ones to their own `visualId`
(always exactly correct); a Rare/Epic Specimen recovers it from its
still-present source Line's own `baseVisualId` (Specimens track
`sourceLineId`, so real provenance exists); a Rare/Epic Line has no
tracked parent lineage to recover from at all, so it safely falls back to
its own `visualId` too (never a crash, never fabricated data — the same
"safe fallback over fabrication" philosophy the rest of this file already
uses).

Verification: `scripts/verify-specimens.ts` (`node
scripts/verify-specimens.ts`) — guarantees, Day-3+ appearance
probabilities, stat generation, discovery timing, all four harvest routes,
parent selection (Line×Line/Line×Specimen/Specimen×Specimen/rejecting a
duplicate specimen id), consumption timing + save/reload, the A/B/C/D
Visual+base inheritance rules (including Candidate D's now-Common-only
mutation), Breed TOTAL progression (shared target, +2..+6 range, 360 cap
and its one exception), `baseVisualId` derivation/propagation/ordinary
pricing, Mutation Affinity's absolute-rate math (both the exact bonus
formula and an end-to-end ~10x/~20x statistical check, including that
sibling Rare/Epic visuals stay unboosted), and old-save migration
(including `baseVisualId` recovery). The Breed strategic-pause GATE itself
is a `scenes/MainScene.ts`-level conditional and can't be exercised from
this Node script — documented there as an explicit limitation, along with
Phaser-rendered UI (the Specimen's illustration actually swapping on the
tree, the picker's LINES/SPECIMENS toggle, the stat-help modal/info
buttons), matching `scripts/verify-market.ts`'s own convention.

## Economy

Each apple is priced individually, at the moment it's harvested (see
Shipping Pipeline above), using effective (cultivation-adjusted)
Sweetness/Size plus the current market/shipping multipliers:

```
value per apple  = 2.00 + EffectiveSweetness * 0.010 + EffectiveSize * 0.005
sale value       = value per apple * marketMultiplier * shippingMultiplier
marketMultiplier = clamp(1 + colorModifier + patternModifier, ..., 1.6)
```

Only Sweetness and Size affect price. Rarity (Common/Rare/Epic) is a
separate visual/discovery concept and never multiplies price directly — a
strong Common can outsell a weak Epic. Yield's production advantage is
active-slot count instead (more apples produced over time, not a
higher-value one).

Daily Operating Cost is deducted once per day during Closing — see Daily
Operating Cost below for the exact formula.

Cultivation modifiers (SWEETEN/GROW_BIG) only affect *effective*
Sweetness/Size used for harvest value and contest scoring — genetic stats
used for breeding are never touched, and cultivation never affects Yield's
active-slot count or harvest quantity.

## Market V1

Price exists per **Visual Variety** (the illustration/`visualId`, C1..E2 —
see Visual Rarity above), never per individual owned Line: every Line
sharing a visualId shares the exact same market entry
(`GameState.visualMarket: Record<AppleAssetId, VisualMarketEntry>`,
`systems/market.ts`). This is a farm-market forecast layer, not a
trading/investment sim — there is no buying/selling of market assets, no
intraday ticking, and no permanent Visual Variety names invented for it.

An **undiscovered** Visual Variety has no entry at all and is completely
absent from every Market surface — no silhouette, no "???" placeholder. A
**discovered** one gets a `VisualMarketEntry`:

```
{ visualId, pct, trend: 'RISING' | 'STABLE' | 'FALLING', history: { day, pct }[] }
```

`pct` is percent above/below baseline (`0` = baseline = a 1.00x multiplier);
`history` is oldest-first and capped to `TUNING.MARKET_HISTORY_DAYS` (5)
entries. The multiplier actually used for pricing is `1 + pct`
(`marketMultiplierForVisual`).

**Daily update** (`advanceDailyMarket`, called once per day from
`Game.advanceDayInternal`, strictly after `state.day` is incremented — never
from `loadState`, so a reload can never cause a second same-day update):
every currently DISCOVERED visualId's `pct` moves by

```
dailyMovement = randomNoise + trendBias + meanReversion + eventShock
nextPct = clamp(pct + dailyMovement, MARKET_PCT_MIN, MARKET_PCT_MAX)
```

- `randomNoise` — uniform ±`MARKET_NOISE_AMPLITUDE` (±6%).
- `trendBias` — ±`MARKET_TREND_BIAS` (±2.5%) from the entry's *currently
  displayed* trend (RISING/FALLING; 0 for STABLE) — this is what makes
  trend prediction real: RISING gives tomorrow a genuine positive
  statistical bias and FALLING a genuine negative one, but neither
  guarantees the direction, since the ±6% noise term is larger than the
  ±2.5% bias and can still overcome it on any given day.
- `meanReversion` — `-pct * MARKET_REVERSION_RATE` (15% of the current
  distance from baseline, pulled back every day), which keeps prices from
  drifting away permanently and is what "prices remain inside the chosen
  safe bounds" is proven against alongside the explicit clamp.
- `eventShock` — see Calendar integration below.

The day's own resulting delta (`nextPct - pct`) is then reclassified into
the *newly displayed* trend (`RISING` if `delta > MARKET_TREND_THRESHOLD`
(2%), `FALLING` if `< -MARKET_TREND_THRESHOLD`, else `STABLE`) — which is
what biases the *following* day's movement. `MARKET_PCT_MIN`/`MAX` (-50%/
+60%) are the safe clamp bounds, so the multiplier never leaves 0.50x–1.60x.

**Discovery**: the moment `Game.resolveBreeding()` adds a new visualId to
`discoveredVisualIds`, it also creates a matching `VisualMarketEntry` via
`initVisualMarketEntry` — baseline (`pct: 0`), `STABLE`, one history point
stamped with the current day, and deliberately **no** random move yet
("one update per game day" — its first real movement happens at the next
day transition, same as every other discovered variety).

**Calendar integration / limitation**: `WEEK1_CALENDAR`'s existing scripted
market events (`DayDef.scriptedMarket`, e.g. Day 2's Yellow +30%, Day 6's
Purple +40%/Striped +25%) are keyed by genetic Color/Pattern, which has no
unambiguous mapping onto a Visual Variety's illustration id — a C1 apple can
be bred in any color, so "which visualIds are Yellow" isn't a derivable
fact, and inventing that mapping would be fabricating content the data
model doesn't actually support. Rather than fabricate it, V1 reuses only
the *sign* of the day's existing scripted values
(`eventShockSignForDay`) and applies one shared, smaller
`MARKET_EVENT_SHOCK` (±12%) uniformly to every discovered Visual Variety on
that day — a temporary daily shock only (folded into that one day's
`dailyMovement`), never a permanent baseline rewrite. This is a deliberate,
documented V1 scope limitation, not a bug; a real per-Visual-Variety event
system is future work if it's ever wanted.

**Economy integration**: `priceHarvestedApple` (`systems/economy.ts`) is
unchanged in shape — apple quality (effective Sweetness/Size) × Market
multiplier × shipping multiplier — except the Market multiplier now comes
from `marketMultiplierForVisual(variety.visualId, state.visualMarket)`
instead of the old color/pattern `marketModifiers` bridge (removed
entirely, along with `computeMarketForDay`/`generateMildMarket`/
`describeTopModifier`). Because pricing still happens once, at harvest time,
and is locked into the `ProcessingItem` in the Shipping Pipeline, a Market
change on a later day never retroactively reprices an apple already in the
queue. Operating Cost and the Gross/Net day-log accounting are untouched by
this pass.

**UI**: a weather-report-style overview (`ui/MarketScreen.ts`,
`openMarketOverview`) shows one card per discovered Visual Variety — apple
image, catalog identity (`COMMON · #001` etc, never the internal
`visualId`), today's `+X%`/`-X%` vs baseline, a RISING/STABLE/FALLING badge,
and a self-normalized ~5-day sparkline. It's opened from the existing HUD
Market headline (a small interactive zone over that text, no new
bottom-nav tab, no HUD reorder) rather than a dedicated screen — the
smallest V1 access path, reusable/replaceable during the future Orchard/
global UI redesign. The headline itself (`HUD.ts`) is deterministic:
whichever discovered variety currently has the largest `|pct|`
(`strongestMover`), e.g. `Market: #005 +18% ▸`, or `Market: steady ▸` when
nothing is moving.

**Save migration**: old saves have no `visualMarket` at all (the old
color/pattern `marketModifiers` bridge isn't semantically convertible to
per-Visual-Variety prices, so no mapping is attempted). `migrateState`
initializes a fresh baseline/STABLE entry for every currently
`discoveredVisualIds` entry the save already has, then normal daily updates
proceed from the next day transition onward — identical in spirit to how a
freshly discovered variety initializes.

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

One game Day runs on the `TUNING.DAY_DURATION_SEC` (90s) pacing shown as the
09:00-18:00 clock (see Day Cycle below); reaching 18:00 or clicking END DAY
early both trigger the same Closing procedure.

Closing (`Game.beginClosing()`/`finishClosing()` — see Day Cycle below) ends
with `GameState.dayEnded=true` and a summary modal shown from the
`'dayClosed'` event; only that modal's own "NEXT DAY →" button calls
`proceedToNextDay()`, which resets `dayEnded` and advances the day (or, on
Day 7, sets `weekComplete` and waits for the Week Summary modal's own
continue button before actually advancing — `weekComplete` stays true and
`dayEnded` stays true across that gap too). Both `dayEnded` and
`weekComplete` are persisted GameState, but the summary modals that gate
proceeding past them are transient UI only ever triggered by Closing
finishing — a reload landing between "day ended" and "modal button clicked"
used to leave the player stuck with a permanently-disabled END DAY button
and no code path that could ever show the modal again. `MainScene.create()`
now checks for this on load and re-enters the same flow (reusing the
persisted `lastDayLog`) so the modal always reappears and the game is never
trapped. `beginClosing()` itself already no-ops on a second call
(`this.state.closing || this.state.dayEnded` guard), so repeated END
DAY/Closing calls were never able to double-charge Operating Cost or
double-pay Final Shipment revenue (see Day Cycle and Daily Operating Cost
below).

## Day Cycle

A digital 09:00-18:00 game clock (`systems/clock.ts` `gameClockLabel()`)
maps directly onto the existing `TUNING.DAY_DURATION_SEC` (90s) pacing —
no separate duration was introduced; `TUNING.DAY_START_HOUR`/
`DAY_END_HOUR` are tunable for later playtesting. The HUD's DAY/TIME area
reads `DAY 3 · 14:26` during play; once Closing begins it becomes
`DAY 3 · CLOSING…`, and once Closing completes, `DAY 3 · CLOSED` — the
ended state lives in this same compact area rather than a separate "Day
ended" item (full HUD reorder/redesign is still future work, see below).

Automatic 18:00 Closing (`dayTimeRemaining` reaching 0) and a manual END
DAY click both call the exact same `Game.beginClosing()` — the one shared
Closing procedure, idempotent via an early `if (this.state.closing ||
this.state.dayEnded) return false;` guard, so repeated clicks/calls (or a
reload landing mid-Closing) can never collect or pay twice. Manual END DAY
is available any time the day is playable, not just after 18:00 — ending
early sacrifices whatever growth time remained, by design.

`beginClosing()`:
1. Sets `dayActive = false` and `closing = true` — `closing` (alongside
   `dayEnded`) gates the per-slot regrow loop in `Game.update()`, so growth
   freezes immediately; partially-grown fruit is left exactly as-is, never
   force-ripened.
2. Collects every currently-*ripe* fruit slot across every unlocked/planted
   Field through the same `harvestFruitSlot()` path normal harvesting uses
   — no alternate pricing path — pushing them onto the existing single
   farm-wide Processing Queue.

`Game.update()` then drains that same queue as always, but at an
accelerated **Final Shipment** cadence while `closing` is true
(`TUNING.FINAL_SHIPMENT_SECONDS_PER_APPLE`, default **0.12s/apple** vs the
normal `PROCESSING_SECONDS_PER_APPLE` 1.0s/apple — roughly 8x faster, tuned
so a typical remaining queue finishes in a couple of seconds) — still the
one shared queue, never a second one, never a pricing change. Once the
queue is fully empty, `update()` calls the private `finishClosing()`, which
deducts Daily Operating Cost (see below), runs the day-log settlement math,
and only then sets `dayEnded = true` (`closing` back to `false`) and emits
a `'dayClosed'` event. This ordering — Closing begins → ripe fruit collected
→ Final Shipment queue finishes → Operating Cost deducted → day accounting
finalizes → `dayEnded` becomes the completed closed-day state — is what
keeps Final Shipment revenue attributed to the closing day: the existing
`dayHarvestRevenue`/`dayMarketBonus` guard in `update()` only stops
accumulating once `dayEnded` is actually true, which by construction
doesn't happen until after the queue is empty, so nothing can leak into the
next day's summary — and, by the same construction, Operating Cost can only
ever be deducted once, strictly after Final Shipment has fully paid out.

`MainScene` no longer gets a synchronous log back from ending the day —
`onEndDay()` just calls `beginClosing()`; the END DAY summary modal is
shown from a `'dayClosed'` event listener once Closing genuinely finishes.
The existing reload-recovery check (`dayEnded && lastDayLog` re-entering
the summary-modal flow on load) still covers a reload landing after
Closing completed but before the modal was clicked through; a reload
landing *during* Closing needs no special-case code at all — `closing` is
persisted, so `Game.update()` simply keeps draining the queue at the Final
Shipment cadence and calls `finishClosing()` once it empties, exactly as it
would have without the reload. Old saves without a `closing` field migrate
to `false` (`systems/save.ts`).

Next-day transition (`Game.advanceDayInternal()`) is unchanged in spirit:
clock resets to 09:00 (`dayTimeRemaining = DAY_DURATION_SEC`), growth
resumes, and Shipping returns to the normal 1.0s/apple cadence (explicitly
resets `closing = false` too, defensively, alongside the existing
`dayEnded = false` reset).

Not yet implemented (still future work, see Planned direction below):
the Orchard/global HUD redesign (including the approved
DAY/TIME → MARKET → NEXT CONTEST → MONEY → END DAY ordering), morning
fades/rooster audio/page-flip transitions, and Freshness.

## Daily Operating Cost

ONE Operating Cost number is deducted once per day — never split into
itemized categories (fertilizer/labor/electricity/etc.). It's computed and
charged inside `Game.finishClosing()` (see Day Cycle above), which by
construction only ever runs once per day, strictly after Final Shipment has
fully drained the Processing Queue — so Operating Cost can never double- or
early-charge, and Final Shipment revenue is always in `cash` before
Operating Cost comes out of it.

`systems/economy.ts` `operatingCost(day, fieldCount)` replaces the old flat
`dailyExpenses()` bridge (rather than stacking a second expense on top of
it) with one small linear formula, two additive components:

```
operatingCost = OPERATING_COST_BASE
              + fieldCount * OPERATING_COST_PER_FIELD
              + OPERATING_COST_PER_DAY * max(0, day - 1)
```

`OPERATING_COST_BASE` (15) and `OPERATING_COST_PER_FIELD` (20) keep the old
bridge's exact values, so a Day 1, 1-Field farm still costs exactly $35 —
no sudden balance shock from this pass. `OPERATING_COST_PER_DAY` (3) is the
new gentle day-over-day progression term (`day` is 1-based, so Day 1 itself
adds none of it) — pure linear growth, never compounding, so later days
rise slowly enough for breeding/productivity improvements to realistically
keep ahead of it (Day 7 on the same 1-Field farm: $53; add all 3 extra
Fields on Day 7 and it's $113 — an obvious but not extreme jump from
Fields, unchanged in kind from the old per-Field term).

`DayLogEntry.operatingCost` (renamed from the old `expenses` field — old
saves' persisted `lastDayLog.expenses` migrate to `operatingCost` in
`systems/save.ts`) keeps the existing day-log accounting shape: gross day
revenue is still `harvestRevenue + marketBonus + contestPrize`, `net =
gross - operatingCost`. Money is displayed as `$X.XX` everywhere (HUD,
shipment feedback, and now the END DAY summary too — its rows previously
rounded to whole dollars, discarding real cents), so `finishClosing()`
rounds `harvestRevenue`/`marketBonus` to the nearest **cent** rather than
the nearest whole dollar (same "round the combined total once, derive one
component as the remainder" trick as before, just at cents precision).

`cash` itself keeps accumulating each apple's exact, unrounded fractional
value in real time all day (see Shipping Pipeline above) — that per-apple
precision is deliberately untouched. At the settlement boundary,
`finishClosing()` reconciles `cash` against the exact same rounded
`harvestRevenue`/`marketBonus`/`contestPrize`/`operatingCost` figures the
summary displays (`nonRevenueCash = round_cents(cash - dayShipmentRevenue -
contestPrize)`, then `cash = nonRevenueCash + net`) — not by independently
re-rounding `cash`'s own running total. Two independently-rounded numbers
that are mathematically supposed to agree can still land a cent apart on
adversarial fractional inputs (floating-point addition isn't associative),
so deriving both the displayed Net *and* the actual `cash` change from the
identical rounded figures is what guarantees `displayed cash before +
displayed Net == displayed cash after`, to the cent, by construction — not
merely "usually." Only revenue (`dayHarvestRevenue`/`dayMarketBonus`/
`dayContestPrize`) is reconciled this way; anything else that moved `cash`
that day (Field/Irrigation/Shipping purchases, breeding costs — always
exact whole-dollar amounts already) is left completely untouched, so this
never conflates spending with revenue. This is also why `cash` ends up an
exact multiple of $0.01 after every settlement, forever, by induction — no
new persisted state or integer-cents rewrite needed for it.

`GameState.totalRevenue` keeps its existing gross-lifetime-sales-revenue
meaning; Operating Cost is never subtracted from it (only from `cash` and
the per-day `net`), so the Week Summary's "Total Revenue" stat is
unaffected by this pass. The END DAY summary modal's former "Expenses" row
is now labeled "Operating Cost", and every row uses the same `formatMoney`
(`$X.XX`) formatting as the rest of the money UI — no other UI changed.

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
(both default false), and `recentParentIds` (default `[]`). Since the
Orchard Mutation / Breeding Specimen pass: `specimens: []`, per-slot
`specimen: null`, `day1/day2SpecimenGuaranteeUsed: false` (a save still on
Day 1/2 with the guarantee not yet spawned receives it once on load, never
retroactively on a Day 3+ save), and `BreedingState.parentA/BKind: 'LINE'`
with null specimen snapshots. A save with no
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
  longer has a clean per-field equivalent — fruit slots regrow continuously
  through `dayActive` going false (the day timer simply running out), which
  matches that pass's explicit goal of a continuously living orchard.
  The Shipping Pipeline pass later added back a narrower freeze: once
  `GameState.dayEnded` is true (the player actually clicked END DAY and it
  resolved), slot timers stop advancing entirely — already-ripe fruit stays
  ripe, partially-grown fruit stays frozen at its exact progress, and no new
  fruit can ripen — so a settled day visibly stops producing new fruit
  while the END DAY summary is on screen. The Day Cycle pass (see Day Cycle
  above) widened this same freeze to also cover the whole Closing window
  (`state.closing`, not just `dayEnded`), and added the accelerated Final
  Shipment cadence that actually drains the Processing Queue at day's end
  instead of leaving it to trickle in at the normal rate.

Offspring resolution is intentionally forced: the player must KEEP exactly
one of the four candidates (no discard/reroll option). This is a core
playtest hypothesis, not a soft-lock — a candidate can always be kept and
breeding continues normally afterward.

## Planned direction (decided, not yet implemented)

Decisions made after the current playable baseline commit `666052d`. None of
this is built yet — recorded here so intent survives until each piece is
actually implemented. Update each subsection into the relevant section above
(and remove it from here) once it ships.

### Orchard / global UI redesign

Direction: warm painterly orchard look — cream rounded cards, dark green top
HUD, gold accents, painterly orchard background. Orchard stays the visual
hero (5 trees: 3 front / 2 back, unchanged from today). Planned layout:

- Lower-left card: stats readout — Sweetness / Size / Yield / Growth /
  Freshness.
- Bottom navigation stays icon-based but becomes much more compact than
  today's full-width bar.
- Lower-right white card combines CHANGE VARIETY + shipping/basket status +
  processing status + HARVEST ALL into one card.
- Current RED BASIC / +FIELD tab presentation will be cleaned up later as
  part of this redesign, not before.
- Approved top-HUD ordering: **DAY / TIME → MARKET → NEXT CONTEST → MONEY →
  END DAY**. "Day ended" should eventually be represented within the DAY /
  TIME area itself, not as a separate full HUD item. The shipment `+$X.XX`
  feedback (see Shipping Pipeline above) is anchored directly below MONEY.
  This is a future HUD/layout direction only — not implemented as part of
  this redesign entry yet.

Not implemented yet; do not build ahead of the priority order below. The
shipping/basket status + processing status portion of the lower-right card
already has a real implementation to surface (see Shipping Pipeline above)
once this redesign happens — it isn't placeholder-only anymore.

### Mutation Spray (future money sink — design only, not implemented)

A future paid farm treatment: spend cash to temporarily increase
mutation/Specimen odds. Must never guarantee a Rare/Epic outcome — a
probability nudge only, same spirit as the existing Day-3+ Orchard roll
and Mutation Affinity, never a purchasable certainty. Exact price and
multiplier are not decided yet; not implemented in this pass.

### Shipping Infrastructure (future system — design only, not implemented)

The current farm-wide Processing Queue (see Shipping Pipeline above) has
effectively unlimited throughput once Closing's accelerated Final
Shipment cadence kicks in, which trivially erases any bottleneck at day's
end. A future pass is expected to introduce real finite shipping/packing
capacity plus shipping-speed and capacity upgrades, so Closing can no
longer simply flush an unbounded queue for free. Exact
implementation/numbers are not decided yet; explicitly out of scope for
this pass (no Shipping Box, no capacity/speed upgrades implemented here).

### Market graph polish (future UI pass — design only, not implemented)

`ui/MarketScreen.ts`'s current sparkline is self-normalized per card (see
Market V1 above) rather than sharing one shared scale across cards. A
future polish pass is expected to give it a fixed shared vertical scale, a
visibly marked 0% baseline, and a clearer visual distinction between a
Visual's current level and today's own movement — conceptually something
like:

```
+10%
Today -4pt ▼
```

Not implemented in this pass; the current Market V1 graph is unchanged.

### Revised priority order

Shipping Pipeline, Day Cycle, Daily Operating Cost, Market V1, and Orchard
Mutation / Breeding Specimen are done (see their sections above) —
remaining order:

1. Orchard / global UI redesign
2. Freshness integration
3. Collection / Library / Replant cleanup
4. Final art / animation / sound / font polish

Market V1 was deliberately built ahead of the UI redesign: the prototype
already had a reasonably engaging core loop, and the open question was
whether each new day creates a genuinely different decision. Operating Cost
added economic pressure; Market V1 is what turns that into real day-to-day
decision-making (when to sell, what to grow).

Mutation-fruit discovery is no longer a small late-game feature — it's now
promoted ahead of the visual redesign because it directly connects Orchard →
Harvest → Discovery → Breed → Line ownership (see Orchard Mutation /
Breeding Specimen / Breed connection above), fixing the structural
disconnect playtesting surfaced between harvesting and breeding. The full
visual redesign follows once that connective loop exists, not before.
