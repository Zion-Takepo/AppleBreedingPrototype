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
**COLLECTION**, plus a top HUD of separate cards (day/time, cash, market
highlight, next event, END DAY button — see "Orchard UI Redesign (Structure
Pass)" below for the current card-based layout). Nav tabs show a small red
dot when a screen has a pending useful action (harvest ready, breeding
result ready, unseen trait discovery).

## First-session onboarding

**Implemented.** Human playtesting found that a new player could harvest
apples for 10-20 seconds, never realize the game was actually about
breeding, never reach BREED, and quit. This is a lightweight, state-driven
coach system — not a blocking tutorial — that deliberately leads a first-time
player HARVEST → notice Packing/shipping → find the Day-1 guaranteed
Specimen → open BREED → use it as a parent → BREED → inspect the four
candidates → KEEP one.

**State** (`types.ts` `OnboardingState`, `GameState.onboarding`): just
`{ step, dismissed }`. `step` is the player's CURRENT goal — one of
`HARVEST_APPLE → FIND_SPECIMEN → OPEN_BREED → START_BREED →
KEEP_OFFSPRING → COMPLETE` — and only ever advances forward
(`Game.advanceOnboardingTo()`, a no-op unless the target step is strictly
further along than the current one). `dismissed` is set once by SKIP GUIDE
and independently hides the objective banner forever for this save without
touching `step` or any game progression/rewards.

**Progression hooks** — each lives on the exact existing action method, no
separate tracking layer:

- `Game.harvestFruitSlot()`: a normal apple harvest advances
  `HARVEST_APPLE → FIND_SPECIMEN`; harvesting a Specimen (via the same
  method's specimen branch) advances straight to `OPEN_BREED` — since
  `advanceOnboardingTo` only ever moves forward, a player who finds the
  Specimen FIRST (before ever harvesting a normal apple) safely jumps past
  both A and B in one step rather than getting stuck waiting for the
  "expected" order. This also means `beginClosing()`'s own "secure every
  ripe Specimen" collection step can itself advance onboarding if it
  happens to sweep up a still-uncollected guaranteed Specimen at Closing.
- `MainScene.showScreen()` calls `Game.onboardingBreedScreenOpened()` on
  every navigation to the BREED tab — advances `OPEN_BREED → START_BREED`,
  a no-op at any other step.
- `Game.startBreeding()`: a successful call advances `START_BREED →
  KEEP_OFFSPRING`.
- `Game.keepOffspring()`: a successful call advances `→ COMPLETE` and emits
  a one-time `'onboardingComplete'` event, which `MainScene` turns into a
  short toast ("NEW LINE CREATED — Breed again to improve stats, specialize
  traits, or preserve a visual lineage.") via the existing `ToastQueue` — no
  new notification widget. Once `step === 'COMPLETE'` the objective banner
  stops rendering for good; there is no large mandatory tutorial and no
  further nagging.

**UI** (`ui/OnboardingBanner.ts`): one reusable compact card (never a full
modal, never scattered text boxes), redrawn only when the step actually
changes. Fixed top-right placement (`x=1110, y=68, w=372`, dynamic height)
was chosen specifically because it stays clear of every other screen's own
top-of-content elements at the two screens it's shown on — Orchard's field
tabs sit top-LEFT, and Breed's Parent A/B cards / offspring-candidate cards
/ "i" stat-info button all start further down or further right. It is only
shown while ORCHARD or BREED is the active screen (the two screens the
onboarding path actually leads through) — Calendar's full-width day-chip
strip occupies this exact same top band, so showing it there was skipped
rather than fought pixel-by-pixel; the underlying `onboarding.step` state
itself still progresses correctly regardless of which screen is active, this
is a display-only scope reduction. A small "Skip Guide" text link sits in
the banner's own top-right corner (`Game.skipOnboarding()`). Separately,
`ui/BottomNav.ts` layers three pieces onto the BREED tab for exactly as long
as `onboarding.step === 'OPEN_BREED'` (`!dismissed`, checked every
`refresh()`): the original subtle, non-flashing label alpha-yoyo pulse
(`0.45 ↔ 1.0`, 550ms — kept, see PROJECT.md's "obnoxious flashing"
exclusion, which this still respects) plus two much stronger additions from
human playtest feedback that the pulse alone was too easy to miss — a solid
4px **white ring** stroked around the whole tab (`breedRingGfx`, drawn once
at construction, toggled by `setVisible`, never touching the tab's existing
interactive `zone`/hitbox) and a small bobbing **pointing-hand chevron**
(`breedPointer`, a minimal Phaser `Graphics` triangle rather than a Unicode
glyph, per this feature's own "draw a shape if a glyph would be unreliable"
guidance) hovering just above the tab, alpha-yoyo-free but position-bobbing
8px via a plain up/down tween. All three stop the instant the condition
goes false — BREED opened (onboarding advances past `OPEN_BREED`), guide
skipped, or onboarding already complete — and none permanently alter the
tab's normal styling once that happens.

**Market discoverability hint** (`GameState.marketHintShown`, never resets):
deliberately NOT part of the onboarding chain above (it fires after/around
onboarding completion, never before Breed). Shown at most once ever, from
whichever of two trigger points happens first — right after
`'onboardingComplete'` (with a short delay so the two toasts, which don't
stack/queue in this codebase's `ToastQueue`, don't visually overlap) or the
next `'dayAdvanced'` event (fired at the end of every day transition) if
onboarding hasn't completed yet — both funnel through
`MainScene.maybeShowMarketHint()`, itself guarded by
`Game.markMarketHintShown()`'s own idempotency. Never force-opens Market,
never redesigns it.

**Save migration** (`systems/save.ts`): a save with no `onboarding` field at
all infers a reasonable starting point from existing save data rather than
always restarting an experienced player's guide from step 1 — `step`
defaults to `COMPLETE` (and `marketHintShown` to `true`) if the save has
ever bred (`breeding.everBredOnce`) or owns more than the two starter Lines;
otherwise it starts fresh at `HARVEST_APPLE`. An existing valid
`onboarding` object (a save already written by this pass) is validated,
never reinferred; an invalid/corrupt `step` value falls back safely to
`HARVEST_APPLE`. `resetPrototype()` returns onboarding to the exact fresh
start (it just rebuilds the whole initial state, no special-casing needed).

## Pre-Closing warning, 18:00 Closing cue, and Day transition fade

**Implemented.** Playtesting also found the sudden jump to automatic 18:00
collection surprising, and the flat day-to-day transition unsatisfying.
None of this changes Closing's own capacity-aware collection rules, the
Freshness formula, Operating Cost, or Shipping Speed — purely presentation
and heads-up timing layered on top.

**Pre-Closing warning** (`GameState.closingWarningShown`, reset every day in
`Game.advanceDayInternal()`): fires once, from inside `Game.update()`'s
existing day-clock block, keyed off the digital clock via
`systems/clock.ts` `dayTimeRemainingAtClock(hour, minute)` (the exact
inverse of `gameClockLabel`) rather than a second, independently tuned
real-time duration — `TUNING.CLOSING_WARNING_CLOCK` (17:00, one hour before
automatic 18:00 Closing). Revised from the original two-warning table
(17:30 + 17:50, two persisted flags) after human playtesting found two
separate warnings unnecessary — one clean flag replaces both, with no dead
duplicate state left behind. Emits a `'closingWarning'` event (no payload —
there's only the one warning now); `MainScene` shows a compact, non-blocking
"CLOSING SOON · 1 HOUR" toast via the existing `ToastQueue` plus a short
procedural audio cue (see below). The check lives inside the
`if (this.state.dayActive)` block, so a manual END DAY that closes the day
before the threshold is reached can never fire it afterward — `dayActive`
is already false by then and the block simply stops running. **Save
migration**: a save written under the old two-flag system with either old
flag already `true` migrates `closingWarningShown` to `true` too (17:00 is
strictly earlier than both retired thresholds, so the player was already
past it); a save with neither, or with no legacy flags at all, migrates to
`false` (see `systems/save.ts` `migrateState`).

**18:00 Closing cue** (`GameEvent` `'closingBegan'`, `{ automatic: boolean
}`): `Game.beginClosing(automatic = false)` now takes an explicit flag —
the 18:00 timer trigger inside `Game.update()` calls `beginClosing(true)`,
a manual END DAY click (`MainScene.onEndDay()`) calls the zero-arg default
(`false`) — and emits `'closingBegan'` immediately, before its existing
collection sequence runs. `MainScene` shows a short centered "CLOSING /
Final collection" overlay (`showClosingCue()`, ~850ms total: 150ms in, 500ms
hold, 200ms out — inside the approved 0.5-1.0s range) only when
`automatic === true`, since a manual END DAY click already gives the player
immediate button feedback. Closing's own collection sequence is never
delayed by this — it proceeds normally underneath the overlay.

**Day transition fade** (`MainScene.runDayTransition()`): the End Day
summary modal's "NEXT DAY →" (and Day 7's "CONTINUE →") button now goes
through this instead of calling `proceedToNextDay()` directly. Sequence:
disable repeated activation (`dayTransitionInProgress` guard) → manual
full-screen black overlay fades in (300ms) → while black: `showScreen('ORCHARD')`
(closes any transient screen-specific UI, e.g. BreedScreen's own rename DOM
input, via its existing `setVisible(false)` teardown, and returns the active
screen to ORCHARD) → run the actual day-advance (`proceedToNextDay()`) →
`refreshAll()` → a centered **"DAY N"** label (using the actual
newly-advanced `GameState.day`, never "DAY COMPLETE" — this is the start of
the new day) appears over the black screen and holds for 600ms → the label
and overlay fade back out together (400ms) → the next-day audio cue plays →
once that fade-out completes, run `after()` (e.g. opening the Week Summary
modal on Day 7, deliberately shown AFTER the transition settles rather than
during the black window). Total transition ≈1.3s, inside the ~1-1.5s target
— short and clean, not cinematic. Deliberately uses a manual full-screen
`Rectangle` + `Text` (both tweened directly, the same pattern
`showClosingCue()` already used) rather than `cameras.main.fadeOut/fadeIn`:
Phaser's camera Fade FX is a post-render effect drawn on top of everything
that camera renders, so a Game Object added at any depth during a camera
fade would still be invisible behind it — there'd be no way to show the DAY
N label while the screen reads as black using the camera FX alone. This is
a **UI/navigation reset only** — no Lines, Specimens, Market state, or Breed
progress are touched; if a Breed operation is in-flight, it's simply not
the visible screen anymore, its own state is untouched. `MainScene.create()`
still does its own short entrance `cameras.main.fadeIn` (400ms, no DAY-N
label) when first entering the playable game — kept as the simpler existing
camera-fade approach rather than folding it into the new helper, since it
has no day-advance/label to show.

**Audio cues** (`systems/audio.ts`, new — no audio infrastructure existed in
this codebase before this pass): the smallest possible Web Audio solution
for exactly three short, gentle procedural sine-tone cues (pre-Closing
warning, Closing begins, next day begins) — NOT ambient BGM, NOT a harvest
SFX library, NOT external/downloaded assets (those remain explicit future
polish, see "Open playtest findings" below). Exactly one `AudioContext` is
ever lazily created; every `play*()` call is a no-op until
`unlockAudio()` has been called from a genuine user gesture
(`MainScene` wires this to the scene's first-and-every `pointerdown`, per
browser autoplay policy — `unlockAudio()` itself is idempotent once it
succeeds) and gracefully no-ops on any failure (no Web Audio support,
context creation/resume failure) rather than throwing.

**Serialized transient notifications** (`ui/modals.ts` `ToastQueue`): every
screen shares one `ToastQueue` instance (constructed once in
`MainScene.create()` and passed to `OrchardScreen`/`BreedScreen`/
`CalendarScreen`), so it's the single presentation layer every toast-style
message already went through — breeding-ready, trait-discovered,
specimen-acquired, packing-full, the Pre-Closing warning, onboarding-
complete, the Market hint, field-purchase, and contest-result toasts alike.
Browser playtesting found some of these could fire close enough together to
visually overlap at the same on-screen slot. Fixed with one small internal
FIFO array (`QueuedToast[]`) rather than solving each pair individually:
`show()` now pushes onto the queue and only starts presenting immediately if
nothing is already showing; each toast's existing fade-in/hold/fade-out
sequence is unchanged, but its fade-out's `onComplete` now calls
`presentNext()` instead of just destroying itself, so the next queued toast
(if any) only begins its own entrance once the current one has fully
finished — never overlapping, trigger order always preserved, nothing
silently dropped. The one-time Market hint's old workaround (a manual
2400ms `delayedCall` after the onboarding-complete toast, specifically to
avoid the two overlapping before this queue existed) was removed as
redundant — `maybeShowMarketHint()` is now called immediately, and the
shared queue naturally serializes it behind whatever's already showing. The
persistent onboarding objective banner (`OnboardingBanner`) and the BREED
nav-tab callout are NOT toasts and don't go through this queue — they're
always-visible/state-driven overlays, not transient messages, so they were
never a source of the overlap this fixes.

Verification: `scripts/verify-onboarding.ts` — onboarding's forward-only
state machine (including the Specimen-first skip-ahead case and the
never-regresses guarantee), SKIP GUIDE, save/reload persistence, Day 2 not
restarting Day 1 progress, `resetPrototype()` restoring the start, no extra
Specimen generation, the Market hint's single-fire guarantee, the
Pre-Closing warning (fire-once, reset-next-day, no reload replay, no
post-manual-END-DAY firing, legacy two-flag save migration), `'closingBegan'`'s
automatic/manual distinction, and the revised Packing Capacity table;
re-run alongside `verify-market.ts`, `verify-market-display.ts`,
`verify-specimens.ts`, `verify-shipping-infrastructure.ts` (updated for the
new capacity table — see "Shipping Infrastructure" above), and
`verify-freshness.ts` (likewise updated), all still green. The objective
banner's exact on-screen layout, the BREED nav-tab's white-ring/pointing-hand
callout and label pulse, the Closing-cue overlay, the day-transition black
screen and its "DAY N" label, the serialized `ToastQueue`'s actual on-screen
non-overlap, and the three audio cues are Phaser-rendered/browser-only
concerns not exercised by that Node script — see the implementation report
for what still needs human browser verification.

## Orchard

- Up to 4 Fields, one variety each, selected via the compact top-left Field
  card's dropdown-style switcher (see "Orchard UI Redesign (Structure
  Pass)" below; a `+ FIELD` pill on the same card buys the next one).
- Each Field renders 5 procedural trees: 3 front-row and 2 back-row. All
  five trees use the same visual scale — the two back-row trees are
  positioned higher to suggest depth, but are never smaller (see "Orchard
  UI Redesign (Structure Pass)" below). Each tree has 3 physical fruit
  slots arranged in a triangle, so each Field has 15 physical fruit slots
  total, though not all are necessarily *active* — Yield determines how
  many slots are active/productive (see Yield below). There is **no
  whole-field growth cycle** — each active slot
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

## Living Orchard Motion Prototype

**Implemented — CURRENT PLACEHOLDER ART ONLY.** A first pass at making the
Orchard feel alive while idle (no clicking), built entirely on the existing
five procedural trees/fruit — no new art, no redesign, no audio yet. Answers
one question only: is this motion foundation worth building the final
Orchard art on top of? See `src/game/render/orchardWind.ts` (the wind model)
and `src/game/render/OrchardTreeLayer.ts` (how trees/fruit consume it).

- **Shared breeze**: one `WindModel` instance per `OrchardTreeLayer`, a pure
  function of elapsed time — a normalized-ish value from two slow,
  incommensurate sine waves (avoids a repetitive single-oscillator look)
  plus an occasional gust envelope (smooth rise → brief peak → smooth fall,
  next gust's start time chosen once — a random 10–25s out — then simply
  waited out, never rerolled per frame). Advances once per `sync()` call, so
  it only ticks while the farm simulation isn't paused for Breed, matching
  every other Orchard-presentation timer in this file.
- **Shared wind dominates** (retuned after human feedback that five trees
  read as independent pendulums rather than one breeze): every tree targets
  the exact same instantaneous `wind.value` — there is no more per-tree
  time-shifted sampling of the signal. The only per-tree individuality left
  is a small amplitude scale (±10%) and a small response/easing-speed
  difference (settle lag roughly 0.05–0.20s between trees), both rolled
  ONCE at construction, never rerolled — enough that the five trees don't
  move in frame-perfect lockstep, not enough to look like separate
  oscillators. Normal canopy rotation amplitude and fruit secondary-sway
  amplitude were also both increased (canopy ~1.8x, fruit ~1.9x their
  original values) so the idle breeze reads as clearly alive without
  deliberately watching for it; a small horizontal drift (same shared
  signal, same direction as the tilt) was added alongside the rotation.
  Gust strength was also raised so a gust now peaks at roughly 2–2.5x the
  base breeze's own amplitude. All sway-magnitude constants live in one
  tuning block at the top of `OrchardTreeLayer.ts`.
- **Foliage vs. trunk**: each tree's root container (world position/scale +
  trunk graphic) is stationary; canopy graphics and all 3 fruit slots sit
  under a child `windPivot` that actually rotates (plus the small shared-
  signal horizontal drift above). The trunk stays rooted regardless of wind
  strength — untouched by this retune.
- **Fruit secondary sway**: each `FruitSlot`'s own local `angle` (previously
  unused — reveal/harvest tweens only ever touched scale/alpha) is driven
  every frame proportionally to its OWN tree's current canopy angle (not
  the raw wind directly) — "inherits canopy movement, plus a bit more" —
  eased in more slowly than the canopy itself so it visibly lags rather
  than tracking it 1:1, with its own small amplitude/response variation
  rolled once at construction. Interactive hitboxes are unaffected by
  rotation (unchanged `Circle` hit area on the same pivot), so the visible
  apple and its click target never diverge.
- **Composability**: ambient sway only ever sets `angle`; every existing
  gameplay tween (reveal pop-in, harvest pop-out, the Exceptional ring/glint
  pulses) only ever sets `scale`/`alpha`. The two systems can't fight over
  the same field.
- Verification: `scripts/verify-orchard-wind.ts` covers the wind model's own
  math in isolation (continuous variation, gust scheduling window/duration,
  envelope shape, delayed sampling) — it does not exercise Phaser rendering,
  transforms, or hitbox alignment, which need human browser verification.

**Not yet implemented** (future Living Orchard passes, in rough order):
1. Final layered painterly Orchard art (this pass is placeholder art only —
   see "Orchard UI Redesign (Structure Pass)" below for the now-implemented
   layout that final art will be built around).
2. Environmental ambience — wind audio, birds, time-of-day sound.
3. Reactive harvest/shipping polish.
4. Time-of-day visual atmosphere.

## Orchard UI Redesign (Structure Pass)

**Implemented — layout/composition only, CURRENT PLACEHOLDER ART.** The
approved final Orchard UI structure and tree layout, built with the existing
procedural trees/apples/panels — no painterly scenery, no audio. Final
painterly art assets are a separate later pass; this pass only locks the
composition they'll be built around.

ORCHARD UI DIRECTION LOCKED:
- scenery-first — no tall permanent side panels (see `ui/OrchardScreen.ts`)
- separate top status cards (DAY/TIME, CASH, MARKET, CONTEST, END DAY), not
  a full-width bar (`ui/HUD.ts`)
- deep forest green + warm cream + restrained gold accent palette
  (`ORCHARD` in `ui/theme.ts`), layered on top of — not replacing — the
  existing `THEME` tokens Breed/Calendar/Collection still use
- five equal-size playable trees (`render/OrchardTreeLayer.ts`
  `TREE_LAYOUT` — all five share one `scale`; depth comes from position
  only, never from shrinking the rear two)
- compact top-left Field card (current Field index/total, planted Line name
  + dropdown-style field switcher, Add Field pill) replacing the old
  horizontal field-tab strip
- compact lower-left Stats card — Sweetness/Size/Yield/Growth/Freshness
  with small glyph icons, for the currently selected Field/Line
- compact lower-right Orchard action card — Cultivation segmented control,
  Change Variety, Packing count/capacity (detailed cadence/cost stay behind
  the existing Shipping Infrastructure modal), HARVEST ALL
- compact centered bottom navigation bar (`ui/BottomNav.ts`) with
  horizontal breathing room on both sides, replacing the old full-width strip
- final painterly art assets still pending (see "Living Orchard Motion
  Prototype" above)
- Living Orchard motion remains approved/frozen — untouched by this pass
  beyond the tree scale/position changes above (wind model, sway tuning,
  reveal/harvest tweens, hitboxes all unchanged)

Do not mark final Orchard presentation complete — final art/audio passes
remain.

## Orchard Background V1

**Implemented.** The approved external painterly Orchard background
(`public/assets/orchard/orchard_background.png`) is now imported and
displayed, used exactly as supplied — no tinting/blurring/derivative
processing. Loaded once in `MainScene.preload()` under the shared
`ORCHARD_BACKGROUND_KEY`/`ORCHARD_BACKGROUND_PATH` (exported from
`ui/OrchardScreen.ts`) and drawn as the bottom-most layer inside
`OrchardScreen`'s own Container, filling the full 1600x900 logical canvas,
behind the five procedural trees/fruit and behind all Orchard UI — never
interactive, so it cannot capture pointer input or block fruit
click/sweep. Scoped to the ORCHARD screen only (it's part of
`OrchardScreen`'s own Container, shown/hidden as a whole), so
Breed/Calendar/Collection are unaffected. The five trees/apples remain a
separate procedural layer on top of it — final tree/fruit art is still
pending, and moving clouds/time-of-day atmosphere remain only a possible
later enhancement, not part of this pass.

## Shipping Pipeline

Harvesting (individual click/sweep or HARVEST ALL — both feed the identical
path) never awards cash directly. Instead each harvested apple is priced
immediately — locking in that field's *current* cultivation policy plus the
*current* market/shipping multipliers into the apple's own record, so later
changes to cultivation, variety, or market never retroactively reprice an
apple already in the pipeline — and pushed onto **one shared, farm-wide**
processing queue (`GameState.processingQueue`, an array of
`{ fieldId, value, baseValue }`; NOT one queue per Field — buying another
Field raises production but never speeds up the shared shipping line). This
queue is also the **Packing Box**'s physical storage and has a **finite
capacity** — see "Shipping Infrastructure" below for the capacity gate,
Closing's capacity-aware collection, and the Packing Capacity / Shipping
Speed upgrade tracks; this section covers the queue's own draining/pricing
mechanics, which those build on rather than replace. Only the queue's head
item has an active timer (`GameState.processingTimer`); ticked every frame
in `Game.update()` regardless of day state, matching the Orchard's own
continuous-regrow policy. `value`/`baseValue` are exact, **unrounded**
dollar amounts — rounding every individual apple to a whole dollar would
swamp small Sweetness/Size differences (a $2-4 per-apple range quantized to
$1 steps), so the queue, `cash`, and `totalRevenue` all carry full
fractional precision; both `cash` (HUD) and every shipment's own feedback
display it rounded to exactly two decimal places (`$50.00`, `+$2.75`)
rather than a whole dollar. Every `Game.shippingCadenceSeconds()` seconds
(driven by the owned Shipping Speed level — Level 1 is 1.0s/apple; see
"Shipping Infrastructure" below), the head ships automatically: its value
pays into `cash`/`totalRevenue`
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
increments as apples ship rather than jumping in a lump sum. The
shipment-box display (bottom-right of the Orchard view, not yet part of the
future full redesign) now shows live Packing occupancy/capacity and the
current Shipping cadence — see "Shipping Infrastructure" below. Every queued
`ProcessingItem` also carries its own frozen `freshness` and accumulating
`packingWaitSeconds` (see "Freshness" below) — the value a shipment actually
pays out is that locked value's Freshness-adjusted *realized* amount, not
the raw locked `value`.

## Shipping Infrastructure

**Implemented.** The Processing Queue above now has a **finite Packing
Capacity** and a tunable **Shipping Speed**, both permanent, purchasable
farm upgrades — the core design goal is that growing Yield/production
eventually pressures logistics instead of Closing's old accelerated Final
Shipment silently erasing any bottleneck for free. See `Game.ts`
(`harvestFruitSlot`, `beginClosing`, `buyPackingCapacityUpgrade`,
`buyShippingSpeedUpgrade`, `packingCapacity`, `shippingCadenceSeconds`),
`systems/economy.ts` (`packingCapacityForLevel`, `packingUpgradeCost`,
`shippingCadenceForLevel`, `shippingSpeedUpgradeCost`,
`finalShipmentCadenceSeconds`), and `TUNING.PACKING_CAPACITY_LEVELS` /
`TUNING.SHIPPING_SPEED_LEVELS` for the exact tables.

**Packing Capacity** (`GameState.packingCapacityLevel`, 1-5, default 1):
the maximum length `processingQueue` may hold — 18/24/32/40/50 apples at
Levels 1-5, upgrade cost $100/$225/$450/$850 (Lv1->2 through Lv4->5). Revised
from the original 12/18/24/32/40 · $150/$350/$700/$1200 table (see
"First-session onboarding" below) — human playtesting found the original
Level 1 (12) too restrictive and the early upgrade costs too steep for a
new player's first session. Only these tuning numbers changed; every
mechanic described below is unchanged.
`Game.harvestFruitSlot` checks `processingQueue.length >= packingCapacity()`
**before** any mutation — a normal ripe apple hitting a full Packing Box is
a pure no-op: it stays ripe on its exact slot (no slot rotation, no queue
item, no revenue) and a `'packingFull'` event fires for UI feedback. A
**Breeding Specimen is always exempt** — the capacity check only applies
when `slot.specimen` is null, so a ripe Specimen is collectible through the
identical `harvestFruitSlot` path regardless of Packing occupancy, on every
route that reaches it (direct click/sweep, HARVEST ALL, Closing).

**Shipping Speed** (`GameState.shippingSpeedLevel`, 1-5, default 1): the
queue's normal (non-Closing) per-apple processing cadence —
1.00/0.80/0.65/0.52/0.42 seconds at Levels 1-5, upgrade cost
$200/$450/$900/$1600. `Game.processingCadenceSeconds()` (private) reads this
whenever the *next* processing interval is scheduled — buying the upgrade
mid-day never retroactively rescales whatever timer is already counting
down on the current head item; only the interval scheduled after it next
ships uses the new, faster cadence. **Final Shipment** (Closing's
accelerated drain, replacing the old fixed 0.12s/apple) is now *derived*
from the currently-owned Shipping Speed level rather than a separate table:
`max(TUNING.FINAL_SHIPMENT_CADENCE_MIN (0.08), normalCadence *
TUNING.FINAL_SHIPMENT_CADENCE_MULT (0.20))` — Lv1 ≈0.20s, Lv2 ≈0.16s, Lv3
≈0.13s, Lv4 ≈0.104s, Lv5 ≈0.084s — so investing in Shipping Speed pays off
both during normal play and at Closing. If Closing begins while the head
item's still-running *normal*-cadence timer is slower than the current
Final Shipment cadence, `beginClosing()` clamps it down to that faster
cadence once (never lengthens an already-shorter remaining timer) so
Closing still reads as "accelerated now," without a timer-rewrite scheme
for the general case.

**Closing's capacity-aware collection sequence** (`Game.beginClosing`,
replacing the old "collect everything ripe, then flush the whole queue"
behavior that made Packing Capacity meaningless): growth freezes exactly as
before, then, in order —

1. **Every currently-ripe Specimen, across every unlocked/planted Field, is
   secured first** — through the same `harvestFruitSlot` path, so Packing
   Capacity never applies. No Specimen can ever be lost to Closing.
2. **ONE normal-fruit collection pass.** `freePackingSlots =
   packingCapacity() - processingQueue.length` (occupancy AFTER Specimens
   are secured, which never changes it). Every remaining ripe *normal*
   apple across all Fields is priced via the existing
   `priceHarvestedApple` (no second pricing formula), ranked **highest
   current sale value first**, and only the top `freePackingSlots` are
   actually harvested into the queue — ties break deterministically by
   Field order then slot index (`Array.prototype.sort` is stable, and the
   candidate list is already built in that exact order, so a plain
   value-descending sort preserves it for ties). Any normal ripe apple that
   doesn't fit is left **untouched**: still ripe, on its exact slot, not
   deleted, not counted as revenue — it survives into the next day and
   blocks that slot from growing new fruit until it's actually harvested.
3. Final Shipment then drains the queue at the (possibly-clamped)
   accelerated cadence as before; `finishClosing()` settles Operating Cost
   and the day log exactly as before, completely unchanged by this pass.

This is a **single collection pass** — once Final Shipment empties the
queue, nothing goes back to the trees for a second round that same Closing,
which is what keeps Packing Capacity meaningful (otherwise a
collect-12-then-flush loop could still drain an unbounded crop for free).
A carried-over ripe apple's sale value is **not** locked at the Closing
day's Market rate, since it was never actually harvested — when it's
eventually harvested (any later day), it uses whichever Market rate is
current *at that moment*, then locks in normally like any other harvest.

**UI** (`ui/OrchardScreen.ts`'s shipment-box display, `ui/ShippingInfraModal.ts`):
the existing placeholder box now reads `PACKING 8/12` / `1.00s / apple` and
is clickable, opening a compact modal with two independent upgrade tracks
(Packing Capacity, Shipping Speed) — each showing Current/Next/Cost, an
UPGRADE button that deducts cash and persists the new level immediately, or
`MAX` once Level 5 is reached. No new bottom-nav tab; not the planned full
Orchard/global UI redesign. A full-Packing harvest attempt shows a compact
`PACKING FULL · 12/12` toast (`scenes/MainScene.ts`, reusing the existing
`ToastQueue`), throttled to at most one per ~1.5s so a hold-and-sweep drag
across several blocked apples — or a single HARVEST ALL click blocked on
many slots — can't stack dozens of toasts.

**Save migration**: `packingCapacityLevel`/`shippingSpeedLevel` default to
1 on any save missing them (`systems/save.ts`). An old save whose
`processingQueue` already exceeds Level 1's capacity of 12 is **never
truncated** — it's left exactly as-is and simply drains naturally; the
capacity gate only blocks *new* normal apples from entering while
occupancy is at or above capacity, so an over-capacity legacy queue is
self-resolving rather than a migration hazard.

Verification: `scripts/verify-shipping-infrastructure.ts` — capacity
gating (including the Specimen exemption), HARVEST ALL's
Specimens-first/capacity-capped-normal-fruit behavior, both upgrade
tracks' exact level/cost tables and MAX/insufficient-cash rejection,
mid-day Shipping Speed purchase not rescaling an in-flight timer, the full
Closing sequence (Specimens-first, single collection pass, highest-value
priority, deterministic Field-order tie-break, overflow survival,
carryover repricing), the Final Shipment cadence formula and its
Closing-time clamp (both directions), and save migration (default levels,
preserved/self-draining over-capacity legacy queue); `scripts/verify-freshness.ts`
covers Freshness's own decay/retention math and its integration with this
system (see "Freshness" below) and was re-run green alongside this suite.

## Freshness

**Implemented (V1).** Freshness protects an apple's already-locked harvest
value from decaying while it waits in the shared Packing queue — it applies
**only after harvest**; a ripe apple still on the tree never accumulates
Packing wait time and never decays. See `src/game/systems/freshness.ts`
(`freshnessLossFraction`/`freshnessRetention`/`realizedShippingValue`),
`TUNING.FRESHNESS_*`, and `types.ts`'s `ProcessingItem` doc comment.

**Harvest lock**: the instant a normal apple enters `processingQueue`
(`Game.harvestFruitSlot`), its `ProcessingItem` freezes both its
Market-adjusted `value` (unchanged from before this pass — see Shipping
Pipeline above) and its exact genetic `freshness` (0..100), and starts
`packingWaitSeconds` at 0. Both are frozen onto the individual queued apple,
never re-derived later from whichever Line currently happens to be planted —
replanting, breeding, or a later Market move can never alter an
already-queued item.

**Formula** (`systems/freshness.ts`), applied at Shipping realization time,
using the item's own frozen `freshness` and accumulated `packingWaitSeconds`:

```
freshness01          = clamp(freshness / 100, 0, 1)
effectiveWaitSeconds  = max(0, packingWaitSeconds - FRESHNESS_GRACE_SECONDS)
protection            = FRESHNESS_MAX_PROTECTION * freshness01
lossRatePerSecond      = FRESHNESS_BASE_LOSS_PER_SECOND * (1 - protection)
lossFraction          = min(FRESHNESS_MAX_LOSS, effectiveWaitSeconds * lossRatePerSecond)
retention             = 1 - lossFraction
realizedValue         = lockedHarvestValue * retention
```

`TUNING.FRESHNESS_GRACE_SECONDS` (2.0s — no loss at all before this),
`FRESHNESS_BASE_LOSS_PER_SECOND` (0.02 — 2%/s at Freshness 0),
`FRESHNESS_MAX_PROTECTION` (0.80 — Freshness 100 cuts the loss rate by 80%),
`FRESHNESS_MAX_LOSS` (0.30 — a locked value can never lose more than 30%,
however long it waits). Rare/Epic rarity never affects this formula. Exact
fractional precision is used internally; rounding only happens at display
time, same as the rest of the money model.

**Queue-age semantics**: every item in `processingQueue` — the head
currently being timed and everything waiting behind it — ages by
`dtSeconds` once per frame inside `Game.update()`'s existing farm-simulation
block (`processingQueue.forEach` ahead of the head's own ship-timer drain),
so it's already gated by the exact same `pauseFarmSimulation` flag as
growth/day-clock/Shipping itself: Breed's strategic pause (see "Breeding"
below) freezes it with no catch-up delta on resume, and Closing/Final
Shipment keep advancing it exactly like normal Shipping does, since Closing
never sets that pause flag. Age stops the instant an item leaves the queue
(ships) and is preserved exactly across save/reload (plain persisted
per-item state, no derived/recomputed timer).

**Shipping realization**: when an item reaches the front of the queue and
its ship-timer elapses, `Game.update()` computes `realizedShippingValue`
from its locked `value`/`freshness`/`packingWaitSeconds`, pays that
`realizedValue` (not the locked `value`) into `cash`/`totalRevenue`
unconditionally, and emits the `'shipment'` event with that same
`realizedValue` — so the HUD's existing `+$X.XX` feedback (`HUD.ts`,
unchanged) already shows the true realized amount with no separate wiring
needed. `dayHarvestRevenue`/`dayMarketBonus` keep accumulating the LOCKED
`baseValue`/`value - baseValue` split exactly as before this pass (guarded
by `!dayEnded`, unchanged); a new same-guarded accumulator,
`GameState.dayFreshnessLoss`, sums each shipment's `value - realizedValue`.

**Daily accounting**: `Game.finishClosing()` rounds the day's LOCKED
shipment total once (as before) to split `harvestRevenue`/`marketBonus`,
and separately rounds the day's REALIZED shipment total
(`dayShipmentRevenueLocked - dayFreshnessLoss`) once, deriving
`DayLogEntry.freshnessLoss` as the remainder between those two rounded
totals — the same "round once, derive the rest as a remainder" construction
this method already used for harvestRevenue/marketBonus, now extended so
`harvestRevenue + marketBonus - freshnessLoss` reconciles to the rounded
realized total exactly, to the cent. `net = harvestRevenue + marketBonus -
freshnessLoss + contestPrize - operatingCost` (Operating Cost's own formula
is unchanged). The `cash` reconciliation subtraction in the same method now
uses the REALIZED shipment total (matching what was actually paid into
`cash` in real time this pass), not the locked one.

**End Day summary** (`ui/EndDayModal.ts`): a `Freshness Loss  -$X.XX` row
sits between Market Bonus and Contest Prize, always shown (including
exactly $0.00) for row-list consistency with the existing unconditional
Contest Prize/Operating Cost rows.

**Stat help / Shipping Infrastructure UI**: `ui/StatHelpModal.ts`'s
FRESHNESS entry now describes the actual V1 gameplay meaning (not the exact
formula/constants); `ui/ShippingInfraModal.ts` adds one small explanatory
line ("Freshness protects apple value while waiting in Packing.") under its
two upgrade tracks.

**Save migration**: a `ProcessingItem` persisted before this pass has
neither field — `freshness` backfills to a neutral 50 (never fabricates the
apple's real historical genetic Freshness), `packingWaitSeconds` backfills
to 0 (never retroactively punishes an old save for unknown historical
waiting time). `GameState.dayFreshnessLoss` backfills to 0; a persisted
`lastDayLog` from before this pass backfills `freshnessLoss: 0` (that day
genuinely had none, unlike the queue backfill's neutral default).

**Strategic relationships** (unchanged intent, now all connected): Yield
pressures Packing Capacity; Growth pressures Shipping throughput; Packing
Capacity lets the farm hold more at once but can lengthen queues; Shipping
Speed reduces Packing wait time directly; Freshness reduces the financial
penalty of whatever wait time remains. None of the five is made irrelevant
by this pass.

Verification: `scripts/verify-freshness.ts` — the decay/retention formula
(grace period, exact percentages at Freshness 0/50/100, the 30% loss
cap/70% retention floor, monotonicity in both Freshness and wait time,
0..100 clamping), harvest-time locking (frozen freshness/value, wait
starting at 0, immunity to later Market/Line changes), queue-age semantics
(head and waiting items both age, Breed-pause freeze with no catch-up,
Closing/Final Shipment continuing to age, save/reload preservation),
Shipping realization (realized value paid, shipment event uses it, no
double payment), accounting (freshnessLoss reconciliation, unharvested/
unshipped fruit contributing nothing, Operating Cost unchanged), tree
carryover (no aging/decay before harvest), infrastructure interaction
(faster Shipping reduces loss for an otherwise-identical queue, Specimens
untouched), and save migration (neutral defaults, preserved queue/
infrastructure levels) — re-run alongside `verify-market.ts`,
`verify-market-display.ts`, `verify-specimens.ts`, and
`verify-shipping-infrastructure.ts`, all still green.

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
- **Freshness** (`TUNING.FRESHNESS_*`, `systems/freshness.ts`) protects an
  apple's already-locked harvest value while it waits in the shared Packing
  queue — see "Freshness" below for the full V1 mechanic. It has no effect
  before harvest (on-tree fruit never decays) and never affects Growth,
  Yield, or Market movement.
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
  speed, and Freshness reduces value loss while harvested apples wait in
  Packing (see "Freshness" above for the full V1 mechanic). Same close
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

**DISCOVERED != OWNED applies to Color/Pattern too, not just visualId**
(`ui/CollectionScreen.ts`'s TRAITS tab): a genetic Color (e.g. Purple) or
Pattern (e.g. Striped) registers as DISCOVERED the instant it's shown on
ANY of the four Breed candidates — including the Day-1 guaranteed Yellow
opportunity and the Day-5 guaranteed Purple-or-Striped candidate (see
"Breeding" below) — regardless of whether that particular candidate is ever
KEPT (`systems/breeding.ts` `breedOffspring`'s `newlyDiscoveredColors`/
`newlyDiscoveredPatterns`, folded into `GameState.discoveredColors`/
`discoveredPatterns` by `Game.resolveBreeding()`). This is intentional and
unchanged — the same "a Visual shown as a candidate becomes DISCOVERED"
rule the visualId system above already uses. What was a bug was the
TRAITS tab's presentation: it used to show the same ✓ check mark for
"DISCOVERED" that the rest of this document (and MarketScreen's own
OWNED/DISCOVERED ONLY badge) reserves for OWNED, so a Color/Pattern seen
only as an un-kept candidate (e.g. the Day-5 guarantee firing on a
candidate the player didn't choose) could show a check mark the player
reasonably read as "I have this," despite no Library Line actually
carrying it. Fixed as a presentation-only change — the check mark now
unmistakably means OWNED (a kept Library Line currently has this Color/
Pattern, derived live from `GameState.library` every render, exactly like
`Game.isVisualIdOwned()` derives Visual ownership — never a second
persisted array/flag); DISCOVERED-but-not-OWNED shows a distinct "SEEN"
label instead of the check; UNDISCOVERED keeps its existing `?` treatment.
No discovery rule, Breed candidate generation, or the Day-1/Day-5
guarantees themselves changed at all.

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
`visualId`), today's `+X%`/`-X%` vs baseline, a compact `Today ±Npt`
daily-movement line, and a ~5-day sparkline. It's opened from the existing
HUD Market headline (a small interactive zone over that text, no new
bottom-nav tab, no HUD reorder) rather than a dedicated screen — the
smallest V1 access path, reusable/replaceable during the future Orchard/
global UI redesign. The headline itself (`HUD.ts`) is deterministic:
whichever discovered variety currently has the largest `|pct|`
(`strongestMover`), e.g. `Market: #005 +18% ▸`, or `Market: steady ▸` when
nothing is moving.

**Graph clarity pass** (presentation only, no simulation/pricing change —
`systems/marketDisplay.ts`): every card's sparkline shares one fixed
vertical mapping, `TUNING.MARKET_PCT_MIN..MAX` (-50%..+60%) → chart
bottom..top (`pctToChartUnit`), instead of each card self-normalizing to
its own recent min/max — a +10% entry now always reads as only modestly
above baseline, and cards are directly visually comparable to each other. A
dashed, neutral-gray 0% reference line is always drawn (the fixed range
always spans 0) — dashed specifically so it stays visually distinguishable
from the solid green history line even where the two nearly overlap. The
large current `+X%` (baseline-relative level) is now paired with a smaller
`Today ±Npt` line showing the newest day's movement in whole percentage
points, derived from the latest two `history` entries
(`dailyChangeFromHistory`) — this is what makes `+10% / Today -4pt ▼`
readable as "still above baseline, but fell today" instead of the two
numbers implicitly conflicting. `Today ±Npt` is the card's only visible
directional indicator — the separate RISING/STABLE/FALLING text row was
removed as a second playtest polish pass once this line existed, since the
two said the same thing; `VisualMarketEntry.trend` itself is completely
unaffected and still drives next-day trend bias exactly as before, it's
just no longer echoed as its own row. The vertical space that row freed
went to the sparkline itself, grown from ~42px to 64px tall (still the
exact same fixed -50%..+60% mapping, just easier to read) with `CARD_H`
unchanged at 280. One history point displays `Today —` rather than
inventing a prior value. No change to trend calculation, history length,
clamp range, or any other Market V1 simulation rule; see
`scripts/verify-market-display.ts` for focused chart-mapping/daily-change
verification (kept separate from `scripts/verify-market.ts`, which still
covers simulation behavior only).

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
- Shipping (sale-value bonus): $400 then $1000, +10% sale value per level,
  max 2 — distinct from the Shipping *Speed* logistics upgrade below.
- Packing Capacity (see "Shipping Infrastructure"): $100/$225/$450/$850 for
  Levels 2-5 (18/24/32/40/50 apples), max 5.
- Shipping Speed (see "Shipping Infrastructure"): $200/$450/$900/$1600 for
  Levels 2-5 (1.00/0.80/0.65/0.52/0.42 sec/apple), max 5.
- No upgrade ever raises genetic Sweetness/Size/Yield directly — that's
  breeding's job only.

## Calendar

Week 1 (Days 1-6) keeps its original scripted flavor; the old Day 4
Sweetness Contest and Day 7 Apple Fair placeholders are gone, replaced
entirely by Contest V1 (see "Contest V1" below), which is what now owns
every Day-7-and-onward Calendar entry:

| Day | Event |
|---|---|
| 1 | First harvest, first (free) breeding, Yellow discovery opportunity |
| 2 | Yellow market +30%; Field 2 becomes purchasable |
| 3 | Flavor text previews the Day 7 Contest |
| 5 | Mutation day — first breeding guarantees Purple or Striped |
| 6 | Purple +40%, Striped +25% market event |
| 7, 14, 21, 28, 35, ... | **Contest** — see "Contest V1" below for the exact type rotation/schedule |

`systems/calendar.ts`'s `getDayDef(day)` always returns a def for any day
`>= 1` now (never `undefined`) — Day 4 and every Day past 6 that isn't a
Contest day falls through to a generic `Day N` / "An ordinary day on the
farm." entry rather than fabricating scripted content this prototype never
actually wrote for those days. `CalendarScreen`'s day-chip strip is a
rolling 7-day window (`calendarWindowForDay(day)`) aligned to 7-day blocks
starting Day 1 — each block ends on that week's Contest day — instead of a
table hard-coded to days 1-7, so the Calendar stays useful indefinitely past
Day 7 (see "Contest V1" section 6 below) rather than freezing on the
original Week-1 view forever.

One game Day runs on the `TUNING.DAY_DURATION_SEC` (90s) pacing shown as the
09:00-18:00 clock (see Day Cycle below); reaching 18:00 or clicking END DAY
early both trigger the same Closing procedure.

Closing (`Game.beginClosing()`/`finishClosing()` — see Day Cycle below) ends
with `GameState.dayEnded=true` and a summary modal shown from the
`'dayClosed'` event; only that modal's own "NEXT DAY →" button calls
`proceedToNextDay()`, which resets `dayEnded` and advances the day (or, on
Day 7 **specifically** — `this.state.day === 7`, not `>= 7` — sets
`weekComplete` and waits for the Week Summary modal's own continue button
before actually advancing — `weekComplete` stays true and `dayEnded` stays
true across that gap too). This exact-equality fix is new with Contest V1:
the original `>= 7` check re-triggered the Week Summary gate on literally
every single day-end from Day 7 onward, which made it impossible to ever
actually reach Day 8 without going back through "WEEK 1 COMPLETE"/"START
WEEK 2" again — harmless as long as nothing needed to exist past Day 7, but
Contest V1 explicitly requires uninterrupted play through Day 35 and beyond,
so this was a real, load-bearing bug fix, not a style change (see
`Game.proceedToNextDay`'s own comment). Both `dayEnded` and `weekComplete`
are persisted GameState, but the summary modals that gate proceeding past
them are transient UI only ever triggered by Closing finishing — a reload
landing between "day ended" and "modal button clicked" used to leave the
player stuck with a permanently-disabled END DAY button and no code path
that could ever show the modal again. `MainScene.create()` now checks for
this on load and re-enters the same flow (reusing the persisted
`lastDayLog`) so the modal always reappears and the game is never trapped.
`beginClosing()` itself already no-ops on a second call
(`this.state.closing || this.state.dayEnded` guard), so repeated END
DAY/Closing calls were never able to double-charge Operating Cost or
double-pay Final Shipment revenue (see Day Cycle and Daily Operating Cost
below).

## Contest V1

**Implemented.** Contest gives the player a concrete goal for the current
week, gives individual genetic Stats (especially Size, previously the
weakest-differentiated stat — see "Open playtest findings" below) an
additional reason to matter, makes the top-HUD NEXT CONTEST area and
Calendar genuinely useful, and creates another reason to Breed
strategically before 18:00. It replaces the old, thin Day 4 Sweetness
Contest / Day 7 Apple Fair placeholder entirely (submit-a-planted-variety-
mid-day, benchmarks-only scoring, no NPCs) — see `systems/contest.ts`
(pure schedule/scoring/NPC helpers), `Game.ts`'s `advanceContestGate` /
`confirmContestEntry` / `continueFromContestResults`, and
`ui/ContestEntryModal.ts` / `ui/ContestResultsModal.ts` /
`ui/ContestInfoModal.ts`.

**Schedule** (`isContestDay`/`contestNumberForDay`/`contestTypeForDay`/
`nextContestDayAfter`, `TUNING.CONTEST_START_DAY` (7) /
`CONTEST_INTERVAL_DAYS` (7)): Contest begins Day 7, then every 7th day
after that (14, 21, 28, 35, ...), in a fixed four-type cycle
(`CONTEST_TYPES` in `tuning.ts`) that repeats indefinitely — never
randomized, so the player can always see what's coming and Breed toward it:

| Day | Type |
|---|---|
| 7 | BIGGEST APPLE |
| 14 | SWEETEST APPLE |
| 21 | FRESHEST APPLE |
| 28 | GRAND CHAMPION |
| 35 | BIGGEST APPLE (cycle repeats) |

BIGGEST/SWEETEST/FRESHEST judge Size/Sweetness/Freshness respectively;
GRAND CHAMPION rewards overall genetic quality and balance across all five
stats instead of one. Yield and Growth deliberately have no dedicated
Contest of their own in V1 — they already have direct production roles
(active-slot count, regrow speed).

**Scoring** (`systems/contest.ts` `baseContestScore`/`contestScore`/
`rollContestLuck`, `TUNING.CONTEST_*`): for the three specialized Contests,

```
averageStat = (Sweetness+Size+Yield+Growth+Freshness) / 5
baseScore    = mainStat * 0.85 + averageStat * 0.15
actualScore  = clamp(baseScore + luck, 0, 100)
```

(`mainStat` = Size/Sweetness/Freshness for BIGGEST/SWEETEST/FRESHEST). For
GRAND CHAMPION:

```
averageStat = (Sweetness+Size+Yield+Growth+Freshness) / 5
lowestStat  = MIN(Sweetness, Size, Yield, Growth, Freshness)
baseScore    = averageStat * 0.80 + lowestStat * 0.20
actualScore  = clamp(baseScore + luck, 0, 100)
```

`luck` is one shared roll, uniform in `[-3.0, +3.0]`, applied identically to
every entry (player and NPCs alike — see below). Player-facing criteria
text (`contestCriteriaLines`, shown on the entry screen, results screen,
Calendar, and the HUD's Contest info modal) is plain English — "85% Size /
15% Overall Quality / Small Luck Factor", "80% Overall Quality / 20%
Balance / Small Luck Factor" for GRAND CHAMPION — never the raw formula.
Breed math/Sweetness-Size sale formulas are untouched by this pass; Contest
only ever reads a Line's existing five genetic stats.

**Entry = one owned Line, never consumed** (`Game.contestEligibleLines`):
at Contest resolution the player chooses exactly one permanent Library Line
(archived Lines excluded, same convention as the normal Breed Parent
Picker) to represent them — never a held Specimen, never a merely-
DISCOVERED-but-unowned Visual, never a standalone Packing-queue item. The
selected Line is not consumed, deleted, or mutated by entering; nothing is
deducted from Packing or Specimens. This judges "what Line have you bred,"
not "did you happen to keep one apple in inventory at 18:00." A defensive
fallback (`contestEligibleLines().length === 0` — a corrupted/legacy save)
skips the entry screen and resolves with an explicit no-entry outcome
(`entryLineId: null`, `rank: null`, `$0` prize) rather than softlocking the
day.

**NPC competitors** (`TUNING.CONTEST_NPC_NAMES` — Riverbend, Hillcrest,
Maple Hollow, Stonebridge, Cedar Creek — `npcTargetsForContestNumber`/
`rollNpcVariation`): PLAYER + 5 NPC farms = 6 total entries. Contest #1's
(Day 7) NPC target scores are exactly 42/46/50/54/58; every later Contest
adds `TUNING.CONTEST_NPC_PROGRESSION_PER_CONTEST` (4) points to all five
targets, capped at a total progression bonus of
`TUNING.CONTEST_NPC_PROGRESSION_CAP` (20) — so Contest #6 (Day 42) onward
stays fixed at 62/66/70/74/78 forever. This progression is a pure function
of the Contest number alone (`npcTargetsForContestNumber(n)` takes no
player-state argument) — it never reads the player's own Line strength, so
the player should feel genuine breeding progress actually start beating
previously-difficult competition, never secretly rubber-banded to match it.
Each NPC also gets one small one-time result variation
(`TUNING.CONTEST_NPC_VARIATION_MIN/MAX`, ±2.5), generated/persisted exactly
once alongside the rest of that Contest's result.

**Result generation happens exactly once, ever** (`Game.confirmContestEntry`):
confirming ENTER APPLE (or the zero-eligible-Lines fallback) generates the
ENTIRE outcome in one call — the player's score (base formula + one luck
roll), all 5 NPC scores, rank, and prize — and persists it immediately onto
`GameState.contest`. A second `confirmContestEntry` call once
`contest.resolved` is already true is a guarded no-op (returns `null`), so
neither a stray double-click nor a save/reload can ever reroll luck or NPC
results, or pay the prize twice ("reload until I win" is not possible).
Ranking (`rankContestEntries`) uses full internal (floating-point)
precision — display always rounds to one decimal
(`formatContestScore`) — via a stable sort, so an exact internal tie keeps
build order (PLAYER first, then the 5 NPCs in their fixed roster order) as
its deterministic tie-break, the same convention `Game.beginClosing`'s own
highest-value-first collection pass already uses.

**Prizes — V1** (`TUNING.CONTEST_PRIZES`): the same fixed table for every
Contest — 1st $250, 2nd $150, 3rd $75, 4th-6th $0 — deliberately not scaled
by Contest number yet; the goal is human Day 7/Day 14 playtesting before a
balance/progression pass. The prize is non-sale income: it's added to
`GameState.cash`/`dayContestPrize` (the exact same accumulator the old
Day 4/Day 7 placeholder already used) and never folded into
`GameState.totalRevenue`, which keeps its existing gross-lifetime-apple-
sales-only meaning.

**Closing → Contest → settlement sequence** (`Game.update()`'s
`isContestDay` branch, `advanceContestGate`/`continueFromContestResults`):
on a Contest Day, `beginClosing()` and its capacity-aware ripe-fruit
collection are completely unchanged. Once Final Shipment fully drains the
Processing Queue (`processingQueue.length === 0` while `state.closing` is
still true), a normal day would call `finishClosing()` immediately — a
Contest Day instead creates `GameState.contest` for today (if not already
present) and emits `'contestGateReached'`, and **deliberately does not
call `finishClosing()` from `update()` at all while on a Contest day** —
settlement only ever runs from the explicit `Game.continueFromContestResults()`,
called by the Results screen's own CONTINUE TO DAY SUMMARY button once the
player has actually read the result. This is what guarantees the Contest
never resolves before Final Shipment, and EndDayModal can never appear
before the Contest has completed — `state.closing` simply stays true (and
`dayEnded` stays false) for the whole entry/results window, same "still
mid-Closing" semantics as before this pass, just held open longer. A manual
END DAY click goes through the exact same `Game.update()` gating as the
automatic 18:00 trigger, so it follows the identical Contest flow.
`continueFromContestResults()` itself requires `contest.resolved` and
`state.closing`, so a second call (or a stray re-click) after settlement
has already run is a safe no-op — Operating Cost/settlement still only ever
runs once, exactly as before this pass.

**Persistent state** (`types.ts` `ContestState`/`ContestNpcResult`/
`ContestHistoryEntry`, `GameState.contest`/`contestHistory`):
`GameState.contest` holds only the CURRENT/most-recent Contest's full
detail (day, type, resolved, entryLineId, playerScore, npcResults, rank,
prize) — it is deliberately never cleared/reset when the day advances (so
a later day's Calendar/HUD can still show "how did Day 7 go"), which means
callers always check `contest.day === state.day` before treating it as
"today's" gate rather than assuming non-null means "pending today."
`GameState.contestHistory` is a small permanent append-only trail (one
compact entry per resolved Contest — day/type/rank/prize) used only by the
Week Summary's "Contest Wins" stat and Calendar's past-result display;
nothing redundant with `contest` itself is stored twice. Reloading before
entry resumes the entry screen exactly (state.closing/contest both
preserved); reloading after entry but before continuing resumes the
Results screen with the identical persisted outcome; reloading after
settlement cannot re-apply the prize (settlement itself is guarded, see
above).

**DAY N Contest-Day presentation** (`MainScene.runDayTransition`): the
existing DAY N black-screen transition (see "Pre-Closing warning, 18:00
Closing cue, and Day transition fade" below) expands on a Contest Day —
"DAY 7", then "CONTEST DAY! / BIGGEST APPLE", then "Prepare your best
apple." — with a longer ~900ms hold (`CONTEST_DAY_LABEL_HOLD_MS`) instead
of the normal day's 600ms, still short/not cinematic. A one-tick quirk
already present before this pass (Day 7's own END DAY → CONTINUE → button
re-runs this exact transition a second time while `state.day` is still 7,
because of the Week-1-complete gate described above) is guarded
(`contestAlreadyResolvedToday`) so the banner never incorrectly reappears
for a Contest that already resolved earlier the same day — only the plain
"DAY 7" label shows on that second pass.

**17:00 warning**: the existing single Pre-Closing warning (see "Pre-
Closing warning" below) swaps to Contest-specific wording on a Contest Day
— "CONTEST IN 1 HOUR · Prepare your best apple." instead of "CLOSING SOON ·
1 HOUR" — still exactly one warning, no second toast added, same
`closingWarning` event/audio cue.

**Top HUD — NEXT CONTEST** (`ui/HUD.ts`): the existing event-headline area
now reads `NEXT CONTEST · DAY 14 · SWEETEST APPLE` normally, or
`CONTEST TODAY · BIGGEST APPLE` on an unresolved Contest Day (switching
back to the normal "next" phrasing the moment that Contest resolves, even
before the day itself ends). It's clickable — opens
`ui/ContestInfoModal.ts`, a small read-only modal with the Contest's name,
day, judging criteria, and prize table.

**Calendar** — see "Calendar" above: the day-chip strip is now a rolling
7-day window instead of a fixed Days-1-7 table, so it keeps showing "when's
the next Contest, what type" indefinitely; each Contest day's detail panel
shows judging criteria, the prize table, and (once resolved) that Contest's
actual placement/prize from `contestHistory`.

Verification: `scripts/verify-contest.ts` — schedule (Days 1-6 no Contest,
the exact Day 7/14/21/28/35 type sequence, the cycle repeating at Day 35/42,
`nextContestDayAfter` before/on/after a Contest day), scoring (both exact
formulas, luck bounds, higher-main-stat/more-balanced advantages, 0..100
clamping, display rounding never affecting rank), NPC progression (exact
Contest #1 targets, the +4/Contest progression, the +20 cap, variation
bounds, no player-stat dependency), entry eligibility (Library-only,
archived excluded, Specimens rejected, no mutation of the Library or the
selected Line, Packing/Specimens untouched, locks after confirmation, no
reroll on a second call), the full Closing → Contest-gate →
entry/resolution → `continueFromContestResults` → settlement control flow
(including the manual-END-DAY path and the "settlement never happens twice"
guard), prizes (exact table, cash increases once, End Day Contest Prize/Net
integration, `totalRevenue` untouched, Operating Cost unchanged), and save
migration (old saves default `contest: null`/`contestHistory: []`,
mid-gate/mid-results reload resumption, no prize duplication) — re-run
alongside every other `verify-*.ts` script, all still green. The DAY N
Contest presentation, the 17:00 Contest wording, the NEXT CONTEST HUD
headline/info-modal click, and the entry/results screens' actual on-screen
rendering and click-through are Phaser-rendered/browser-only concerns not
exercised by that Node script; see the implementation report for the manual
browser pass performed alongside it (a full multi-week Day 1 → Day 14 run,
including a real BIGGEST APPLE entry/result and arrival at the correctly-
scheduled SWEETEST APPLE Contest, with zero console errors).

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
2. Collects ripe fruit through a **capacity-aware** sequence — every ripe
   Specimen first (Packing Capacity never applies to those), then ONE
   highest-value-first normal-fruit collection pass limited to whatever
   Packing capacity is currently free, all through the same
   `harvestFruitSlot()` path normal harvesting uses (no alternate pricing
   path). Any normal ripe apple that doesn't fit stays ripe on its exact
   slot and survives into the next day rather than being force-collected —
   see "Shipping Infrastructure" above for the exact sequence/priority/tie-
   break rules; that pass is what replaced the old "collect everything
   ripe, unconditionally" behavior described in earlier revisions of this
   file.

`Game.update()` then drains that same queue as always, but at an
accelerated **Final Shipment** cadence while `closing` is true — derived
from the currently-owned Shipping Speed level rather than a fixed constant
(`max(0.08, normalCadence * 0.20)`; Level 1's normal 1.00s/apple cadence
yields ≈0.20s/apple during Closing — see "Shipping Infrastructure" above
for the full table) — still the one shared queue, never a second one,
never a pricing change. Once the queue is fully empty, `update()` calls the
private `finishClosing()`, which
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
DAY/TIME → MARKET → NEXT CONTEST → MONEY → END DAY ordering) and morning
fades/rooster audio/page-flip transitions. (Freshness is now implemented —
see "Freshness" above.)

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

### Shipping Infrastructure V1 — IMPLEMENTED

Finite Packing Capacity, Shipping Speed, and the capacity-aware Closing
collection sequence described above are now implemented — see "Shipping
Infrastructure" earlier in this file for the full mechanics.

### Freshness V1 — IMPLEMENTED

Freshness now genuinely protects a harvested apple's locked value while it
waits in Packing — see "Freshness" earlier in this file for the full V1
mechanic, formula, and accounting integration.

### Market graph polish — IMPLEMENTED

`ui/MarketScreen.ts`'s sparkline now shares one fixed vertical scale across
every card (Market V1's own legal range, -50%..+60%) instead of
self-normalizing per card, draws a visibly marked 0% baseline, and pairs
the current baseline-relative `+X%` with a separate `Today ±Npt` daily-
movement line. See Market V1's "Graph clarity pass" subsection above and
`systems/marketDisplay.ts`/`scripts/verify-market-display.ts`.

### First-session onboarding, Pre-Closing warning/Closing cue/Day transition
fade, Packing retune — IMPLEMENTED

See "First-session onboarding" and "Pre-Closing warning, 18:00 Closing cue,
and Day transition fade" earlier in this file for the full mechanics, and
"Shipping Infrastructure" above for the revised Packing Capacity table
(18/24/32/40/50, $100/$225/$450/$850). Driven by the same human playtest
that flagged the harvest→breed disconnect this file's earlier "Mutation-
fruit discovery" paragraph already describes — this pass specifically
targeted "a new player may harvest for 10-20 seconds, never realize the game
is about breeding, and quit."

### Open playtest findings — deliberately deferred, not implemented

The same human playtest (see "First-session onboarding" above) surfaced
several further issues, judged important but out of scope for that pass.
Recorded here so intent isn't lost before each is actually decided/built —
do not build ahead of the priority order below.

- **Sweetness vs. Size**: both stats currently mostly do the same thing for
  sale value (increase apple value) — that specific distinction is still
  weak. Contest V1 (see "Contest V1" above) now gives Size a genuinely
  distinct strategic objective of its own (BIGGEST APPLE judges 85% Size),
  separate from Sweetness's own SWEETEST APPLE Contest — this is real
  progress, not a full fix: it doesn't touch the underlying sale-value
  formula, and does not claim all Sweetness/Size differentiation is
  permanently solved. A future differentiation pass (if the sale-value
  overlap itself still needs addressing after playtesting Contest) remains
  open. Breed math/sale-value formula untouched for now.
- **Cultivation** (NORMAL / SWEETEN / GROW_BIG): rarely used in practice and
  its purpose isn't obviously communicated. Needs a decision — strengthen
  it, redesign it, fold it into onboarding later, or simplify/remove it.
  Unchanged for now.
- **Breed candidate TOTAL variation**: all four A/B/C/D candidates
  currently share the exact same shared TOTAL target (see "Breeding"
  above's TOTAL progression subsection) — a future balance pass could allow
  modest candidate-to-candidate TOTAL variation while still guaranteeing
  genetic progress, so players choose by highest TOTAL, preferred stat
  distribution, desired Visual, or lineage strategy instead of the four
  candidates being TOTAL-interchangeable. Breed math unchanged for now.
- **Rare/Epic odds visibility**: players want an Orchard button/detail view
  showing the current probability of which Rare/Epic mutation Visuals can
  appear on the currently planted farm, including Mutation Affinity. Not
  implemented.
- **Contest**: Contest V1 implemented (see "Contest V1" above) — the
  previous "keep/implement/remove decision needed" finding is resolved.
  Human Day 7 / Day 14 (and beyond) balance/retention playtesting is still
  needed: whether the fixed V1 prize table feels right, whether the NPC
  target progression is well-paced, whether players actually Breed toward
  an upcoming Contest, and whether GRAND CHAMPION's balance-reward framing
  lands. None of that is claimed solved by this pass — see "Contest V1"'s
  own verification section for exactly what is/isn't covered by automated
  checks.
- **Calendar**: limited functional value today beyond the week strip.
  Possible future direction is a more genuinely calendar-like grid view, but
  readability needs evaluating first. Not redesigned in this pass.
- **Collection**: presentation is too passive/plain — needs a future
  Collection / Library / Replant cleanup pass with stronger visual
  motivation (see "Revised priority order" below, already tracked there).
- **Orchard presentation**: bottom/tree controls need consolidation, the
  rear two trees should eventually match the front trees' apparent visual
  scale, and the Orchard needs a stronger final visual composition overall
  — all deferred to the "Orchard / global UI redesign" entry above.
- **Audio/atmosphere**: harvest SFX, wind/orchard ambience, calm BGM,
  subtle tree/fruit sway, and richer day-start/day-end sound are all
  explicitly desired future polish. The three tiny procedural cues added in
  this pass (see "Pre-Closing warning, 18:00 Closing cue, and Day transition
  fade" above) are functional heads-up cues only — they do NOT count as
  this future audio polish pass.
- **Discoverability**: Market and other supporting systems remain easy to
  overlook beyond this pass's single one-time hint (see "First-session
  onboarding" above). A future global UI redesign needs to establish
  stronger visual hierarchy/discoverability generally, not just for Market.

### Revised priority order

Shipping Pipeline, Day Cycle, Daily Operating Cost, Market V1 (incl. its
graph clarity pass), Orchard Mutation / Breeding Specimen, Shipping
Infrastructure V1 (Packing Capacity / Shipping Speed), Freshness V1,
First-session onboarding / Pre-Closing warning / Closing cue / Day
transition fade / Packing retune, and Contest V1 are done (see their
sections above) — remaining order:

1. Human first-session + Week 1/Week 2+ playtest (validating this pass,
   including Contest V1's own Day 7/Day 14 balance/retention questions —
   see "Contest V1"'s "Human browser test target" note in the
   implementation report)
2. Balance decisions from that playtest — Sweetness vs. Size, Cultivation,
   Breed TOTAL variation, Packing/Freshness tuning, Contest V1 prize/NPC
   pacing (see "Open playtest findings" above for each — Contest's own
   keep/implement/remove decision is now resolved, see "Contest V1" above)
3. Orchard / global UI redesign
4. Collection / Library / Replant cleanup
5. Atmosphere / animation / audio polish
6. Release pass

Do not promote any of the "Open playtest findings" items ahead of this
order automatically before that next playtest actually happens.

Freshness V1 deliberately connects Breeding → Freshness → Packing Capacity →
Shipping Speed → Money without touching any existing Shipping Infrastructure
number (see "Freshness" above) — the next step is playtesting that whole
chain end to end before building further on top of it, not adding another
major system immediately.

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

## Exceptional Specimen genetics core

**Genetics core, Orchard → persisted FruitSlot → Specimen inventory →
existing Breed integration, AND the discovery/reveal UX are all implemented
— Exceptional V1 is complete enough for human Day1→Day7 playtesting.** The
pure genetics math lives in
`src/game/systems/exceptional.ts` — "given a source Line's five Stats, can
we generate interesting, valid Exceptional genetic outliers with
deterministic/testable rules?" No Phaser imports, no GameState mutation, no
save logic in that module itself; verified standalone by
`scripts/verify-exceptional-genetics.ts`. The gameplay wiring described
below lives in `Game.ts` and is verified by
`scripts/verify-exceptional-integration.ts`.

Three archetypes, rolled by `TUNING.EXCEPTIONAL_ARCHETYPE_WEIGHTS` (cumulative
thresholds, see `selectArchetype`): **TRAIT_OUTLIER** 60% (one focus Stat
+10..+16, TOTAL -1..+3 — a specialist, not a universal upgrade),
**HIGH_POTENTIAL** 35% (no focus Stat, TOTAL +4..+7 spread proportionally
across all five Stats), **ELITE_OUTLIER** 5% (focus Stat +8..+14 AND TOTAL
+6..+9 — the rare jackpot). `TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE` (0.006,
0.6%) is defined and unit-tested for the later integration pass but is not
rolled anywhere in current gameplay.

Cultivation biases WHICH Stat becomes the focus for TRAIT_OUTLIER/
ELITE_OUTLIER only (`TUNING.EXCEPTIONAL_FOCUS_BIAS`, `selectFocusStat`) —
NORMAL is an even 20% each; SWEETEN is Sweetness 60% / others 10% each;
GROW_BIG is Size 60% / others 10% each. HIGH_POTENTIAL has no focus Stat, so
Cultivation doesn't affect it. Cultivation never changes the 0.6%
occurrence chance itself — a fully separate roll.

**Gameplay integration** (`Game.ts` `maybeGenerateRandomSpecimen` /
`maybeGenerateExceptionalSpecimen`, called the instant a fruit slot becomes
ripe, same as every other Specimen roll — never rerolled on reload/screen
change/Closing):

- **Day 3+ only** (`TUNING.EXCEPTIONAL_START_DAY`, its own dedicated
  constant — deliberately decoupled from `TUNING.SPECIMEN_RANDOM_START_DAY`,
  the separate gate the existing Visual Mutation roll uses, even though both
  currently equal 3) — never Day 1 or Day 2, whose fruit is handled entirely
  by the separate guaranteed-Specimen path and never reaches this roll at
  all.
- **Priority order per ripened fruit**: the existing Day-1/Day-2 guarantee
  (unaffected, unchanged), then the existing Visual Mutation Common/Rare/
  Epic roll (`rollOrchardSpecimen`, including Mutation Affinity, unchanged)
  — ONLY if that fruit still has no specimen is the Exceptional roll
  (`TUNING.EXCEPTIONAL_OCCURRENCE_CHANCE`, 0.6%) attempted. A fruit can
  never be both a Visual Mutation Specimen and a Genetic Exceptional
  Specimen.
- **Source genetics**: the planted Field's source Line's own five Stats.
  **Cultivation**: the Field's current policy is passed straight into
  `generateExceptionalSpecimen` so the existing focus bias applies — this
  never touches the 0.6% occurrence chance itself.
- **Meaningless-result guard**: if the generated Stats are exactly
  identical to the source Line's Stats (HIGH_POTENTIAL's valid 360-cap
  fallback), no Exceptional Specimen is created — the fruit is treated as
  ordinary. No reroll, no retry, no alternate archetype.
- **Visual identity**: always the source Line's own ordinary production
  visual (`sourceLine.baseVisualId`), for both `visualId` and
  `baseVisualId` on the resulting Specimen — never the Line's special
  identity `visualId`. A Rare/Epic Line's Exceptional apple looks exactly
  like its ordinary crop; Rare/Epic recurrence remains controlled only by
  the existing Visual Mutation + Affinity system.
- **Representation**: the existing `BreedingSpecimen` model, extended with
  two optional fields — `exceptionalArchetype?` / `exceptionalFocusStat?`
  (using `systems/exceptional.ts`'s own `ExceptionalArchetype`/`StatKey`
  types directly) — both `undefined` for every ordinary Visual Mutation
  specimen and every specimen persisted before this pass. No new inventory
  type, no reinterpretation of old specimens.
- **Harvest/Packing/HARVEST ALL**: unchanged — a Genetic Exceptional
  Specimen goes through the exact same `harvestFruitSlot` path every other
  Specimen already uses (added to `GameState.specimens`, never Packing/
  sale/Freshness, capacity-exempt, collected first by Closing and by
  HARVEST ALL), since that path already treats any non-null
  `FieldFruitSlot.specimen` uniformly regardless of its optional metadata.
- **Breed**: no new Breed logic — a harvested Exceptional is just another
  held `BreedingSpecimen` in the existing SPECIMENS parent picker, subject
  to the same one-use/consumption rules as any other Specimen.
- **Contest**: unaffected — Exceptional Specimens remain ineligible;
  Contest only ever accepts permanent Library Lines.
- **Orchard indicator**: a thin warm-gold ring (`OrchardTreeLayer.ts`
  `FruitSlot.setExceptional`), drawn around a ripe Exceptional fruit only,
  with a very gentle alpha pulse, plus 3 tiny sparkle glints
  (`drawSparkle`/`GLINT_COUNT`) twinkling at staggered offsets just outside
  the ring — small enough to never obscure the apple itself, no particle
  system, no change to the fruit's hitbox. Normal fruit and existing Visual
  Mutation Specimens are untouched — this ring/glint pair is the only
  Exceptional-specific tree visual.

**360-cap behavior** (`TUNING.EXCEPTIONAL_TOTAL_CAP`): every generator
clamps each Stat 0..100 and TOTAL <=360, degrading gracefully rather than
failing — a focus increase that would exceed 100 applies only the feasible
remainder; at TOTAL 360, TRAIT_OUTLIER/ELITE_OUTLIER still raise the focus
Stat by compensating elsewhere (others get scaled down to make room), and
HIGH_POTENTIAL (which cannot increase TOTAL at all once capped) returns the
unchanged source as its valid fallback. No unbounded/regenerate-and-retry
loops anywhere — redistribution is a single proportional-scale pass, with a
small bounded corrective step only for rare integer-rounding overflow.

**Exceptional discovery/reveal UX** (this pass — presentation only, no
change to any genetics/occurrence/archetype/cap number above):

- **Acquisition reveal** (`systems/exceptionalReveal.ts`
  `formatExceptionalReveal`, consumed by `MainScene`'s existing
  `'specimenAcquired'` handler): the instant a Genetic Exceptional
  Specimen is harvested, one multi-line "EXCEPTIONAL APPLE!" message goes
  through the same shared `ToastQueue` every other toast already uses — so
  it's automatically serialized against (never overlapping) any other
  transient toast in flight, with no new notification widget. Content is
  archetype-specific: TRAIT_OUTLIER and ELITE_OUTLIER show the archetype
  label, the focus Stat's delta (e.g. `SIZE +14`), and a `TOTAL` delta;
  HIGH_POTENTIAL (no focus Stat) shows only the archetype label and
  `TOTAL` delta. A closing `SAVED AS BREEDING SPECIMEN` line always
  appears. Deltas are computed against the source Line's **current** five
  Stats, looked up live via `Game.getVariety(specimen.sourceLineId)` — if
  that Line can no longer be found, the reveal degrades safely to the
  Specimen's own absolute Stat/TOTAL values instead of a delta, rather
  than crashing or being suppressed (`formatExceptionalReveal`'s
  `sourceStats: StatSet | undefined` parameter). `ToastQueue.show()`
  (`ui/modals.ts`) was extended to size itself from a `\n`-joined
  multi-line message (width from the longest line, height from line
  count, center-aligned) and to accept an optional `holdMs` (default
  1800ms, unchanged for every other existing call site) — the Exceptional
  reveal alone uses a longer 3200ms hold so its several lines are
  actually readable.
- **SFX** (`systems/audio.ts` `playExceptionalFoundCue`): one short, bright
  three-note ascending cue in a higher register than the existing three
  cues, played once alongside the reveal toast — reuses the existing
  single lazy `AudioContext`/`unlockAudio()` infrastructure, no new audio
  system, not a general harvest sound (ordinary harvests stay silent).
- **Specimen UI labeling** (`ui/SpecimenCard.ts`, `ui/SpecimenDetail.ts`):
  both the compact grid card and the enlarged detail view show the
  archetype label (`TRAIT OUTLIER` / `HIGH POTENTIAL` / `ELITE OUTLIER`,
  via the shared `EXCEPTIONAL_ARCHETYPE_LABELS` map) for a Specimen that
  has one; the detail view additionally shows `FOCUS: <STAT>` when a focus
  Stat exists. An ordinary Visual Mutation Specimen (`exceptionalArchetype`
  undefined) never renders any of this — both views already branch purely
  on that field's presence. `ONE USE` and the existing full five-Stat
  display are unchanged.
- **DEV-only force path** (`Game.debugForceExceptional(fieldId?)`): forces
  one currently-available active fruit slot on a planted Field ripe with a
  freshly generated Exceptional Specimen, built through the exact same
  `buildExceptionalSpecimen()` record shape the real Day-3+ roll uses
  (factored out of `maybeGenerateExceptionalSpecimen` so both share one
  construction path) — bypasses only `EXCEPTIONAL_START_DAY` and the 0.6%
  occurrence roll, never the archetype/focus/Stat generation math itself,
  so repeated calls still produce genuinely randomized archetypes. Not
  wired to any UI/button; reachable only via the existing DEV-only
  `window.__debugGame` console exposure (`MainScene.create()`'s
  `import.meta.env.DEV` block) — exactly as production-inaccessible as
  every other already-exposed Game internal there, never a player-facing
  feature.

Playable now: an Exceptional Specimen can appear on a tree Day 3+ with a
noticeable ring/glint indicator, survive reload unchanged, be harvested
into a clear serialized reveal (with SFX) that explains what was special
and confirms it was saved, be identified later in the Specimens list, and
work through the existing Breed system — see "Gameplay integration" above.
