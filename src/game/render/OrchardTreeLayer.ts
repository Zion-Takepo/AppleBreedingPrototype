import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Field, FieldFruitSlot, Variety } from '../types.ts';
import { effectiveStats } from '../systems/economy.ts';
import { AppleVisual } from './AppleVisual.ts';
import { WindModel } from './orchardWind.ts';

// ------------------------------------------------------------------
// Tuning — Orchard presentation only. None of this affects harvest
// quantity/value, regrowth timing, or any other gameplay number (those
// live in Field.slots / Game.harvestFruitSlot / systems/economy.ts).
// ------------------------------------------------------------------

interface TreeLayoutSlot {
  x: number;
  groundY: number;
  scale: number;
  /**
   * Tree-local y (relative to the ground/windPivot origin) where the
   * canopy artwork's own leaf-mass bottom-center registers — see
   * CANOPY_ANCHOR_FRAC below. Varies per tree because the baked trunks in
   * orchard_background.png are hand-painted at slightly different heights;
   * this is a POSITION-only adjustment (see PROJECT.md "Canopy Layer V1"
   * section D / the orchard visual-integration pass) — canopy display
   * size/scale stays identical for all 5 (CANOPY_DISPLAY_W/H below).
   */
  canopyOffsetY: number;
  /** Horizontal flip only — no scale/shape variation (see PROJECT.md "Canopy Layer V1" section B). */
  flip?: boolean;
  /**
   * Which depth row this tree belongs to — selects which of the two
   * row-specific canopy vertical nudges (CANOPY_VERTICAL_NUDGE_FRONT_PX /
   * _BACK_PX below) applies on top of this tree's own canopyOffsetY. Purely
   * a canopy-Y lookup key; depth itself still comes entirely from groundY
   * placement/layer order (back row added first), never from this field.
   */
  row: 'front' | 'back';
}

// 2 back-row trees (positioned higher, peeking between the front row) + 3
// front-row trees, laid out as:
//
//              TREE 4        TREE 5
//
//      TREE 1      TREE 2      TREE 3
//
// Order matters: back row is added first so front row visually sits in
// front of it. HARD REQUIREMENT (see PROJECT.md "Orchard UI redesign" /
// "FIVE TREES — ALL EQUAL VISUAL SIZE"): all five use the identical `scale`
// — depth is suggested by ground placement/layer overlap only, never by
// shrinking the rear two. Do not reintroduce a smaller back-row scale.
//
// x/groundY were measured directly from the baked trunk positions in
// orchard_background.png (converted from that PNG's own pixel space into
// this 1600x900 logical space) so each tree's rotation pivot sits exactly
// on its own baked trunk's ground contact point — see the orchard
// visual-integration pass report for the measurement method. This is why
// groundY differs substantially from the old placeholder-art values: the
// baked trees sit lower/more naturally in the field, per the approved
// composition direction.
// RETUNE (human visual feedback: the far-left/far-right front trunks read
// as too close to the screen edges). TREE 1/TREE 3's own `x` nudged 50px
// inward each (223->273, 1383->1333) — a position-only polish pass, not a
// re-measurement of the baked trunk art; `groundY`/`canopyOffsetY` (still
// tied to each tree's own baked trunk) and TREE 2 (front-middle, already
// central) are untouched.
// RETUNE 2 (human visual feedback: the two back-row trees sit almost
// exactly in the horizontal midpoint of their neighboring front-row gap,
// which is what reads as a continuous "leaf wall" toward the front-middle
// tree — no visible background between the 3 trees clustered in the
// center). Back row only, pulled 25px each AWAY from center-front (TREE 4
// 542->517 toward TREE 1's side, TREE 5 1066->1091 toward TREE 3's side),
// opening a clearer background gap on the front-middle side of each back
// tree. Front row `x` left as-is — already fixed in the prior pass and not
// called out as still edge-hugging this time. `canopyOffsetY` below also
// gets a small per-tree bump this pass (see the canopy-nudge constants
// below) on top of these unchanged `x`/`groundY` values.
// RETUNE 3 (human visual feedback: background still too buried behind the
// trees; composition still feels crowded toward center). Outer 4 trees
// (everyone except TREE 2, kept as the fixed center anchor) nudged another
// 18px further outward each, opening more background at the sides:
// TREE 4 517->499, TREE 5 1091->1109, TREE 1 273->255, TREE 3 1333->1351.
// `groundY`/`scale` untouched, so the existing depth relationship (back row
// higher/added-first, front row lower/added-after) is unaffected.
// RETUNE 6 (human visual feedback: overall X composition now approved —
// only the two outermost FRONT trees needed a small further outward nudge
// to fix a slight remaining misalignment). TREE 1 255->243 (-12, further
// left), TREE 3 1351->1363 (+12, further right). TREE 2 (front-middle) and
// both back-row trees (TREE 4/TREE 5) `x` are untouched — this is
// deliberately NOT a global front-row spread.
// RETUNE 7 (canopy/fruit alignment + per-tree tuning pass): the new canopy
// artwork has directional sunlight, so the two `flip: true` entries below
// (back-right / TREE 5 / index 1, and center-front / TREE 2 / index 3) were
// removed — flipping them now reads as contradictory lighting. All five
// canopies use the source artwork's original orientation; no replacement
// mirroring introduced.
const TREE_LAYOUT: TreeLayoutSlot[] = [
  { x: 499, groundY: 459, scale: 1.0, canopyOffsetY: -84, row: 'back' }, // TREE 4 (back-left) — index 0
  { x: 1109, groundY: 456, scale: 1.0, canopyOffsetY: -83, row: 'back' }, // TREE 5 (back-right) — index 1
  { x: 243, groundY: 594, scale: 1.0, canopyOffsetY: -164, row: 'front' }, // TREE 1 (front-left) — index 2
  { x: 808, groundY: 588, scale: 1.0, canopyOffsetY: -157, row: 'front' }, // TREE 2 (front-middle / center) — index 3
  { x: 1363, groundY: 593, scale: 1.0, canopyOffsetY: -106, row: 'front' }, // TREE 3 (front-right) — index 4
];
// 5 trees x 3 slots = 15, matching TUNING.FRUIT_PER_BATCH — decoupled by
// design (this file is presentation-only), but the two must agree.
const FRUIT_PER_TREE = 3;

// ------------------------------------------------------------------
// Canopy artwork (see PROJECT.md "Canopy Layer V1" — now implemented, not
// spec-only). One shared image, one fixed display size for all 5 trees
// (HARD REQUIREMENT — see TreeNode below). Source is a 4:3 painterly PNG
// with transparent padding above/below the actual leaf silhouette, so
// placement uses the silhouette's own measured bounds rather than the raw
// image edges — see CANOPY_ANCHOR_FRAC/CANOPY_TOP_FRAC.
// ------------------------------------------------------------------
export const ORCHARD_CANOPY_KEY = 'orchard-canopy';
export const ORCHARD_CANOPY_PATH = 'assets/orchard/orchard_canopy.png';
const CANOPY_SOURCE_W = 1448;
const CANOPY_SOURCE_H = 1086;
// RETUNE (human visual feedback: canopy read as too small / thin relative
// to the baked trunks). Bumped from the prior 300x225 up to 380x285,
// preserving the source's exact 4:3 aspect ratio (no distortion) — same
// mechanism as before, just a larger shared envelope.
// RETUNE 2 (human visual feedback: 380x285 read a little too large/heavy
// overall). Small pull-back to 350x263 — same aspect ratio, same
// mechanism, not a rescale of the earlier pass's intent.
// RETUNE 3 (human visual feedback: still slightly too dominant / too much
// continuous canopy coverage). Another small pull-back, 350x263 -> 330x248
// (~5.7% smaller), same aspect ratio, same shared-size mechanism.
// RETUNE 4 (canopy/fruit alignment + per-tree tuning pass): bumped back up
// ~1.15x, 330x248 -> 380x285, same aspect ratio, same shared-size mechanism.
// Fruit anchor spacing (canopyFruitOffsets) is derived from this constant,
// so anchors scale naturally with the larger canopy — no separate change
// needed there.
const CANOPY_DISPLAY_W = 380;
const CANOPY_DISPLAY_H = Math.round((CANOPY_DISPLAY_W * CANOPY_SOURCE_H) / CANOPY_SOURCE_W); // 248
// Measured on the source art: the leaf mass's own bottom-center / top
// extent as a fraction of image height (NOT 1.0/0.0 — there's transparent
// padding on both edges). Used as the Image's origin.y so Phaser's own
// origin math places the anchor exactly, no manual offset arithmetic.
const CANOPY_ANCHOR_FRAC = 977 / 1086;
const CANOPY_TOP_FRAC = 39 / 1086;
const CANOPY_CONTENT_H = CANOPY_DISPLAY_H * (CANOPY_ANCHOR_FRAC - CANOPY_TOP_FRAC);
// RETUNE (human visual feedback: canopy art reads slightly too vivid/bright
// next to the background). A multiplicative vertex tint applied to the
// canopy Image only — Phaser 4's per-object Filters/ColorMatrix system
// (Camera.filters.addColorMatrix()) requires enableFilters() to allocate a
// dedicated filter Camera + framebuffer per Game Object, which is real
// per-object render overhead for what's just a static painterly PNG; a
// plain tint is the smaller, WebGL-cheap, well-supported option and needs
// no extra render passes. setTint() multiplies each texture channel by the
// tint's own channel (255 = no change), never adds/blends toward gray, so
// hue and alpha are preserved — only intensity per channel drops. Channels
// are cut unevenly on purpose: G (the dominant channel in this green
// foliage) drops the most (~11%) to pull it slightly toward R/B and soften
// saturation, R drops the least (~6%) to keep the warm sunlight read, B
// sits between the two (~8%) so it never reads as a blue/gray shift — net
// ~8-9% average intensity reduction, subtle by design.
const CANOPY_COLOR_TINT = 0xf0e3eb; // R 240/255 (-6%), G 227/255 (-11%), B 235/255 (-8%)
// RETUNE (human visual feedback: foliage sat too high above the baked
// trunks, reading as a separate "hat" rather than one connected tree). One
// shared downward nudge applied on top of every tree's own per-trunk
// `canopyOffsetY` (TREE_LAYOUT keeps its per-tree alignment values
// unchanged) — see TreeNode's constructor for where it's applied to both
// the canopy image and the derived fruit anchors.
// RETUNE 2 (human visual feedback: still slightly top-heavy / trunk-canopy
// seam still a little visible). Nudged a little further, 35 -> 50.
// RETUNE 3 (human visual feedback: still a bit top-heavy, and some
// trunk/canopy joins still don't feel fully natural per-tree). Two parts
// this pass, both small: (1) this shared nudge bumped once more, 50 -> 58;
// (2) each tree's own `canopyOffsetY` above ALSO got a small individual
// bump this pass (+2 back row, +3/+4 front row — front trunks are taller,
// so their canopy had further to travel to close the seam) instead of
// relying on this shared constant alone, per the "no single global nudge
// only" feedback. The two combine per-tree (see TreeNode's `canopyY`
// below) into a ~10-12px net downward move per tree versus the prior pass.
// RETUNE 4 (human visual feedback: background still too buried behind the
// canopies, especially the mountains/sky behind the back row — the orchard
// needed to read as sitting a bit lower in the landscape). The single
// shared nudge above is now split into two row-specific constants — front
// row and back row are no longer forced to the same vertical treatment.
// Back row gets the bigger push (58 -> 72, +14) since those two trees sit
// highest in frame, closest to the mountain backdrop, so lowering their
// canopy opens the most background; front row gets a smaller bump (58 ->
// 62, +4) to keep the already-tuned front trunk/canopy joins from the
// prior pass mostly intact while still contributing to the overall
// "sits a bit lower" feel. Depth itself is untouched — still driven purely
// by groundY/layer order (see TREE_LAYOUT), never by this Y nudge.
// RETUNE 5 (human visual feedback: X-axis composition now approved,
// Y-axis only — back row should feel a little more naturally BEHIND the
// front row, and the front row should feel closer/fuller). Row-specific
// split kept exactly as RETUNE 4 established (no reversion to one shared
// constant), just the two values re-tuned in opposite directions: back row
// nudged UP a little (72 -> 64, -8), front row nudged DOWN more (62 -> 78,
// +16 — about double the back row's move, per the "front noticeably lower"
// direction). Still purely a canopy-Y lookup; depth stays driven by
// groundY/layer order alone.
// RETUNE 6 (human visual feedback: depth split still needed to be a
// little stronger — back row should reveal a bit more background behind
// it, front row should read more clearly in front). Row split kept as-is;
// back row nudged UP a little further (64 -> 56, -8), front row nudged
// DOWN more (78 -> 92, +14 — still noticeably more than the back row's
// move, per the "front should move more" direction).
// RETUNE 7 (human visual feedback: X-axis composition approved — front-row
// canopies only needed one more small downward nudge). Front row only,
// 92 -> 100 (+8). Back row constant untouched (56) — the row split already
// gives front-only control, no back-row change needed for consistency.
const CANOPY_VERTICAL_NUDGE_FRONT_PX = 100;
const CANOPY_VERTICAL_NUDGE_BACK_PX = 56;

// Per-tree canopy tuning offsets — FIVE independent constants, one per
// physical tree (replaces the old 3-group back/center/front sharing
// system, which made it impossible to tune the far-right tree, TREE 3 /
// index 4, without also moving TREE 1). Each is applied to BOTH the canopy
// image's own local (x, y) AND that tree's fruit anchors (see
// canopyFruitOffsets + TreeNode's constructor below), so canopy and apples
// move together as one unit and hit areas stay centered on the visible
// fruit — no separate canopy-only vs. fruit-only offset anymore. Start at
// (0, 0) except CENTER, which preserves the previous center adjustment.
const BACK_LEFT_CANOPY_OFFSET = { x: 50, y: -110 }; // TREE 4 (back-left) — index 0
const BACK_RIGHT_CANOPY_OFFSET = { x: -60, y: -110 }; // TREE 5 (back-right) — index 1
const FRONT_LEFT_CANOPY_OFFSET = { x: 50, y: -90 }; // TREE 1 (front-left) — index 2
const CENTER_CANOPY_OFFSET = { x: -5, y: -75 }; // TREE 2 (front-middle / center) — index 3
const FRONT_RIGHT_CANOPY_OFFSET = { x: -45, y: -150 }; // TREE 3 (front-right) — index 4

// Maps each TREE_LAYOUT index (fixed order — see the array above) to its
// OWN independent offset object — no sharing between any two trees.
// Index-based rather than a new TreeLayoutSlot field so TREE_LAYOUT itself
// stays untouched.
const CANOPY_OFFSET_BY_INDEX = [
  BACK_LEFT_CANOPY_OFFSET, // index 0 — TREE 4 (back-left)
  BACK_RIGHT_CANOPY_OFFSET, // index 1 — TREE 5 (back-right)
  FRONT_LEFT_CANOPY_OFFSET, // index 2 — TREE 1 (front-left)
  CENTER_CANOPY_OFFSET, // index 3 — TREE 2 (front-middle / center)
  FRONT_RIGHT_CANOPY_OFFSET, // index 4 — TREE 3 (front-right)
];

/**
 * Apple anchor zones as fractions of the canopy's own measured content
 * height/width (see PROJECT.md "Canopy Layer V1" section E: upper ~73% up,
 * lower-left/right ~±21% width / ~35% up) — computed per-tree from that
 * tree's own canopyOffsetY so all three anchors land on solid leaf
 * silhouette regardless of that tree's particular baked trunk height.
 */
// Small fixed nudge on top of the upper anchor's fraction-derived Y (below)
// — human visual feedback that the top fruit of the triangle sat slightly
// too high relative to the lower two. Lower-left/lower-right are untouched.
const UPPER_FRUIT_Y_NUDGE_PX = 7;

function canopyFruitOffsets(canopyOffsetY: number): [number, number][] {
  const upperY = canopyOffsetY - 0.73 * CANOPY_CONTENT_H + UPPER_FRUIT_Y_NUDGE_PX;
  const lowerY = canopyOffsetY - 0.35 * CANOPY_CONTENT_H;
  const lowerX = 0.21 * CANOPY_DISPLAY_W;
  return [
    [0, upperY],
    [-lowerX, lowerY],
    [lowerX, lowerY],
  ];
}

const ORCHARD_APPLE_BASE_PX = 72; // was 80 — 90% size, uniform across all Orchard fruit
const FRUIT_PIVOT_RADIUS = ORCHARD_APPLE_BASE_PX / 2;

const REVEAL_POP_MS = 200;
const REVEAL_SETTLE_MS = 300;

// ------------------------------------------------------------------
// Fruit-slot presentation stages (EMPTY -> BAGGED -> RIPE) — a pure
// presentation layer on top of the existing per-slot `active`/`ripe`/
// `timer` state (see types.ts FieldFruitSlot, Game.harvestFruitSlot,
// systems/economy.ts fruitRegrowSeconds). Never changes actual regrowth
// duration or Yield/active-slot-count — this only decides which of the
// three visuals a given slot's CURRENT state maps to.
// ------------------------------------------------------------------
export type FruitStage = 'EMPTY' | 'BAGGED' | 'RIPE';

// Bagged/growing art — neutral, does not depend on apple variety/color (see
// PROJECT.md Orchard fruit-lifecycle presentation pass). Loaded the same way
// as every other Orchard asset (see MainScene.preload()).
export const ORCHARD_APPLE_BAGGED_KEY = 'orchard-apple-bagged';
export const ORCHARD_APPLE_BAGGED_PATH = 'assets/apples/orchard_apple_bagged.png';

// First slice of a slot's regrow window shows nothing (a short beat right
// after harvest before the bag appears); the remainder shows the bagged/
// growing art until the slot's own timer says ripe. Purely a split of the
// EXISTING regrow duration (fruitRegrowSeconds) — never changes it. Kept as
// one named constant so the split is easy to retune without touching the
// stage logic itself.
const GROW_EMPTY_FRACTION = 0.12; // 12% EMPTY, 88% BAGGED — within the requested 10-15% band
const BAG_REVEAL_MS = 220; // quick fade/pop from EMPTY into BAGGED — no overshoot, unlike the ripe reveal below

// ------------------------------------------------------------------
// Living Orchard Motion Prototype — ambient wind sway tuning. See
// render/orchardWind.ts for the shared wind signal itself (base breeze +
// occasional gust); everything below only maps that ONE shared value to
// degrees of rotation (and a little horizontal drift) for a given
// tree/fruit. CURRENT PLACEHOLDER ART ONLY (see PROJECT.md "Living Orchard
// Motion Prototype").
//
// RETUNE (human feedback: motion too subtle, five trees read as
// independent pendulums rather than one shared breeze): every tree now
// reacts to the exact same instantaneous `wind.value` — there is no more
// per-tree time-shifted sampling of the signal (the old ±2.2s phase offset
// was large enough, relative to the ~7-11s base breeze period, to visibly
// desync trees). The ONLY per-tree individuality left is a small amplitude
// scale and a small response-speed (easing) difference, both rolled once
// at construction — enough that the five trees don't move in frame-perfect
// lockstep, not enough to look like separate oscillators. To retune "how
// strong/fast the breeze feels," change the four constants in this block;
// there is no other place sway magnitude is computed.
// ------------------------------------------------------------------

// Canopy (foliage): every tree targets the SAME wind.value, scaled by its
// own small amplitude variation and eased in at its own small response
// speed (both rolled ONCE per tree, never rerolled) — the shared direction
// dominates, per-tree differences stay subtle.
// RETUNE (human visual feedback: overall sway read a little too strong).
// CANOPY_SWAY_MAX_DEG, CANOPY_DRIFT_MAX_PX, and FRUIT_SWAY_MAX_DEG below
// all scaled by the same 0.75 factor (2.9->2.175, 5->3.75, 4.2->3.15) —
// a uniform ~25% amplitude cut that keeps the canopy/fruit/drift ratios
// (and therefore the "canopy, plus a bit more" relationship) identical to
// before, not a redesign of the response-speed/timing constants below.
// RETUNE 2 (human visual feedback: foliage sway still slightly too strong).
// Another ~20% cut, same three constants, same ratio-preserving approach:
// 2.175->1.75, 3.75->3.0, 3.15->2.5.
// RETUNE 3 (human visual feedback: still a touch too lively). Another 25%
// cut, same three constants, same ratio-preserving approach, WindModel/gust
// timing/response-rate ranges untouched: 1.75->1.3125, 3.0->2.25, 2.5->1.875.
const CANOPY_SWAY_MAX_DEG = 1.3125; // was 1.75 — now 25% smaller
const CANOPY_DRIFT_MAX_PX = 2.25; // was 3.0 — small horizontal lean alongside the rotation, same direction, same shared signal
const TREE_AMP_SCALE_MIN = 0.9; // ±10% — was ±18%; kept small so the shared wind stays the obvious primary driver
const TREE_AMP_SCALE_MAX = 1.1;
const TREE_RESPONSE_RATE_MIN = 5; // higher = snappier; ~0.05-0.20s settle lag between trees (was ~0.5-0.8s — too slow, read as separate cycles)
const TREE_RESPONSE_RATE_MAX = 20;

// Fruit: inherits the canopy's rotation for free (it's a child of the same
// windPivot) plus its own small secondary pendulum sway, proportional to
// THIS tree's own current canopy angle (so it stays "the canopy, plus a
// bit more") and eased in more slowly than the canopy itself so it visibly
// lags — a filter-lag effect, not a literal delay timer.
const FRUIT_SWAY_MAX_DEG = 1.875; // was 2.5 — now 25% smaller, same scale factor as CANOPY_SWAY_MAX_DEG above
const FRUIT_RESPONSE_RATE_MIN = 4; // slower than canopy's own 5-20 -> ~0.10-0.25s perceived lag behind it
const FRUIT_RESPONSE_RATE_MAX = 10;
const FRUIT_AMP_SCALE_MIN = 0.8; // unchanged — small per-fruit variation, never the dominant signal
const FRUIT_AMP_SCALE_MAX = 1.25;

// Direct-harvest tuning.
const HIT_RADIUS = FRUIT_PIVOT_RADIUS + 16; // slightly larger than the apple itself
const HARVEST_POP_MS = 200;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Tiny sparkle glints around a ripe Exceptional fruit's ring (see
// FruitSlot.setExceptional) — small enough to never obscure the apple
// itself, deliberately not a particle system (this codebase has none) —
// just a few small twinkling shapes on independent alpha-pulse tweens.
const GLINT_COUNT = 3;
const GLINT_ANGLES_DEG = [-55, 60, 195];
const GLINT_RADIUS_PX = 6;
const GLINT_RING_OFFSET_PX = 14;

/** Draws a tiny 4-point sparkle shape centered at (cx, cy) — used for the Exceptional ring's glints only. */
function drawSparkle(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
  g.fillStyle(0xfff6d8, 1);
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r * 0.35, cy - r * 0.35);
  g.lineTo(cx + r, cy);
  g.lineTo(cx + r * 0.35, cy + r * 0.35);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r * 0.35, cy + r * 0.35);
  g.lineTo(cx - r, cy);
  g.lineTo(cx - r * 0.35, cy - r * 0.35);
  g.closePath();
  g.fillPath();
}

/** Live hook a FruitSlot uses to ask the owner to actually harvest it. */
export interface HarvestHooks {
  /**
   * Called synchronously on every click/sweep touch of a ripe, not-yet-
   * harvested fruit, with this slot's flat index (0..14), BEFORE any visual
   * pop plays. Must return whether the harvest actually happened — false
   * (e.g. the Packing Box is full; see Game.harvestFruitSlot) means the
   * fruit stays exactly as it was: FruitSlot skips its pop animation
   * entirely and the fruit remains revealed/harvestable on the tree.
   */
  attemptHarvest: (slotIndex: number) => boolean;
}

/** One fruit position on a tree: reveal-in animation + occasional wind gust + direct-click/sweep harvest. Its ripe/growing state is driven externally by OrchardTreeLayer.sync() from the field's own per-slot state — this class only owns the visual. */
class FruitSlot {
  readonly pivot: Phaser.GameObjects.Container;
  readonly index: number;
  private scene: Phaser.Scene;
  private apple: AppleVisual;
  // Bagged/growing art (see ORCHARD_APPLE_BAGGED_KEY above) — a sibling
  // visual under the same pivot, toggled with `apple` so only one is ever
  // visible at a time. Neutral art, never redrawn per-variety.
  private bag: Phaser.GameObjects.Image;
  private hooks: HarvestHooks;
  // Minimal ring indicator for a ripe Genetic Exceptional fruit only (see
  // PROJECT.md "Exceptional Specimen genetics core" section 12) — a plain
  // Graphics stroke, child of the same pivot as the apple so it inherits
  // reveal/hide/harvest-pop for free without any extra wiring. No text, no
  // particles, no sound — a very gentle alpha pulse only.
  private exceptionalRing: Phaser.GameObjects.Graphics;
  private exceptionalPulseTween?: Phaser.Tweens.Tween;
  // 2-4 tiny glints (see GLINT_COUNT above) that twinkle around the ring —
  // same pivot child treatment as the ring itself, so reveal/hide/harvest-
  // pop already handles them for free.
  private exceptionalGlints: Phaser.GameObjects.Graphics[] = [];
  private exceptionalGlintTweens: Phaser.Tweens.Tween[] = [];
  revealed = false;
  private revealing = false;
  private consumed = false;
  // True from the instant a harvest click is accepted until its
  // shrink/fade pop tween fully completes. While true, OrchardTreeLayer.sync()
  // skips this slot ENTIRELY (identity redraw AND stage transitions) — see
  // sync() — so the exact apple visual/size the player clicked stays frozen
  // through the whole animation instead of possibly being swapped out from
  // under it mid-tween (see PROJECT.md harvest-disappear-color-bug fix).
  private poppingOut = false;
  // Secondary wind sway (see class doc comment + tuning block above) — own
  // amplitude/response speed rolled ONCE per fruit slot so 15 apples on the
  // same tree don't all wobble identically either.
  private swayAngle = 0;
  private readonly swayAmpScale = rand(FRUIT_AMP_SCALE_MIN, FRUIT_AMP_SCALE_MAX);
  private readonly swayResponseRate = rand(FRUIT_RESPONSE_RATE_MIN, FRUIT_RESPONSE_RATE_MAX);

  constructor(scene: Phaser.Scene, offsetX: number, offsetY: number, hooks: HarvestHooks, index: number) {
    this.scene = scene;
    this.hooks = hooks;
    this.index = index;
    // The pivot sits near the fruit's top/stem; the apple is offset
    // downward inside it so rotating the pivot swings the apple from
    // near the stem rather than its center.
    this.pivot = scene.add.container(offsetX, offsetY - FRUIT_PIVOT_RADIUS);
    this.apple = new AppleVisual(scene, 0, FRUIT_PIVOT_RADIUS, ORCHARD_APPLE_BASE_PX);
    this.pivot.add(this.apple);
    // Bagged art: same anchor as the apple, uniformly scaled to the same
    // ORCHARD_APPLE_BASE_PX longest-edge target so it reads as "roughly
    // comparable size" to the ripe apple (same technique AppleVisual.draw
    // uses). Sized once here, never redrawn — bag art is neutral/fixed.
    this.bag = scene.add.image(0, FRUIT_PIVOT_RADIUS, ORCHARD_APPLE_BAGGED_KEY);
    this.bag.setOrigin(0.5, 0.5);
    const bagLongestEdge = Math.max(this.bag.width, this.bag.height);
    this.bag.setScale(bagLongestEdge > 0 ? ORCHARD_APPLE_BASE_PX / bagLongestEdge : 1);
    this.bag.setVisible(false);
    this.pivot.add(this.bag);
    this.exceptionalRing = scene.add.graphics();
    this.exceptionalRing.setVisible(false);
    this.pivot.add(this.exceptionalRing);
    for (let i = 0; i < GLINT_COUNT; i++) {
      const glint = scene.add.graphics();
      glint.setVisible(false);
      this.pivot.add(glint);
      this.exceptionalGlints.push(glint);
    }
    this.pivot.setScale(0);
    this.pivot.setAlpha(0);

    // Hit area centered on the apple's own visual center, a bit larger than
    // the fruit so it doesn't require pixel-perfect clicking. Handles the
    // direct-click case; the hold-and-sweep-from-anywhere case is driven
    // externally via attemptHarvest(), called by OrchardTreeLayer's global
    // pointermove hit-test (see there for why a global approach is used
    // instead of relying on this object's own hover events).
    this.pivot.setInteractive(new Phaser.Geom.Circle(0, FRUIT_PIVOT_RADIUS, HIT_RADIUS), Phaser.Geom.Circle.Contains);
    this.pivot.on('pointerdown', () => this.attemptHarvest());
  }

  setTraits(visualId: Variety['visualId'], size: number): void {
    this.apple.draw({ visualId, size });
  }

  /** Toggles the minimal ripe-Exceptional ring + its few twinkling glints (see class doc comment above). */
  setExceptional(active: boolean): void {
    if (active) {
      this.exceptionalRing.clear();
      this.exceptionalRing.lineStyle(3, 0xf6e2a8, 0.9);
      this.exceptionalRing.strokeCircle(0, FRUIT_PIVOT_RADIUS, FRUIT_PIVOT_RADIUS + 14);
      this.exceptionalRing.setVisible(true);
      this.exceptionalRing.setAlpha(1);
      if (!this.exceptionalPulseTween) {
        this.exceptionalPulseTween = this.scene.tweens.add({
          targets: this.exceptionalRing,
          alpha: 0.55,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      if (this.exceptionalGlintTweens.length === 0) {
        const ringRadius = FRUIT_PIVOT_RADIUS + GLINT_RING_OFFSET_PX;
        this.exceptionalGlints.forEach((glint, i) => {
          const angle = Phaser.Math.DegToRad(GLINT_ANGLES_DEG[i % GLINT_ANGLES_DEG.length]);
          const gx = Math.cos(angle) * ringRadius;
          const gy = FRUIT_PIVOT_RADIUS + Math.sin(angle) * ringRadius;
          glint.clear();
          drawSparkle(glint, gx, gy, GLINT_RADIUS_PX);
          glint.setVisible(true);
          glint.setAlpha(0);
          this.exceptionalGlintTweens.push(
            this.scene.tweens.add({
              targets: glint,
              alpha: { from: 0, to: 1 },
              duration: 520 + i * 140,
              delay: i * 260,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
            }),
          );
        });
      }
    } else {
      this.exceptionalPulseTween?.stop();
      this.exceptionalPulseTween = undefined;
      this.exceptionalRing.setVisible(false);
      this.exceptionalRing.setAlpha(1);
      this.exceptionalGlintTweens.forEach((t) => t.stop());
      this.exceptionalGlintTweens = [];
      this.exceptionalGlints.forEach((glint) => {
        glint.setVisible(false);
        glint.setAlpha(0);
      });
    }
  }

  isPoppingOut(): boolean {
    return this.poppingOut;
  }

  /** Instantly snaps to a stage with no animation — used for hard resets (field/variety switch) and any stage change not caused by the player's own harvest-pop tween. */
  snapToStage(stage: FruitStage): void {
    this.scene.tweens.killTweensOf(this.pivot);
    this.revealing = false;
    this.revealed = stage === 'RIPE';
    this.consumed = false;
    this.apple.setVisible(stage === 'RIPE');
    this.bag.setVisible(stage === 'BAGGED');
    const visible = stage !== 'EMPTY';
    this.pivot.setScale(visible ? 1 : 0);
    this.pivot.setAlpha(visible ? 1 : 0);
    this.pivot.setAngle(0);
    if (stage !== 'RIPE') this.setExceptional(false);
  }

  /**
   * Animated forward transition into BAGGED (quick fade, no overshoot) or
   * RIPE (the original small-overshoot pop-in, unchanged). Only reaching
   * RIPE makes the fruit harvestable — `revealed`/`revealing` gate
   * attemptHarvest exactly as before, so bagged fruit is never harvestable
   * mid- or post-animation.
   */
  growInto(scene: Phaser.Scene, stage: 'BAGGED' | 'RIPE'): void {
    this.scene.tweens.killTweensOf(this.pivot);
    this.apple.setVisible(stage === 'RIPE');
    this.bag.setVisible(stage === 'BAGGED');
    if (stage !== 'RIPE') this.setExceptional(false);
    const toRipe = stage === 'RIPE';
    this.revealing = toRipe;
    this.pivot.setScale(0);
    this.pivot.setAlpha(toRipe ? 0.4 : 0);
    this.pivot.setAngle(0);
    const settle = (duration: number) => {
      scene.tweens.add({
        targets: this.pivot,
        scale: 1.0,
        alpha: 1,
        duration,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.revealing = false;
          this.revealed = toRipe;
          this.consumed = false;
        },
      });
    };
    if (toRipe) {
      // small -> expands (slight overshoot) -> settles, ~0.5s total — same
      // pop the ripe reveal has always used.
      scene.tweens.add({
        targets: this.pivot,
        scale: 1.08,
        alpha: 0.9,
        duration: REVEAL_POP_MS,
        ease: 'Sine.easeOut',
        onComplete: () => settle(REVEAL_SETTLE_MS),
      });
    } else {
      settle(BAG_REVEAL_MS);
    }
  }

  // Click, or hold-and-sweep-over, this specific ripe fruit. Only revealed,
  // fully-settled, not-already-picked fruit qualify. Called both from this
  // slot's own pointerdown (direct click) and externally from
  // OrchardTreeLayer's global sweep hit-test / harvestAllRemaining. Asks
  // the owner FIRST (hooks.attemptHarvest) — Game.harvestFruitSlot can
  // reject a normal apple while the Packing Box is full (see PROJECT.md
  // "Shipping Infrastructure"), in which case this must NOT play the pop
  // animation or mark the fruit consumed: it stays exactly as it was,
  // still ripe and still harvestable on a later attempt.
  attemptHarvest(): void {
    if (!this.revealed || this.revealing || this.consumed) return;

    const harvested = this.hooks.attemptHarvest(this.index);
    if (!harvested) return;

    this.consumed = true;
    this.revealed = false;
    this.poppingOut = true;
    // Only scale/alpha are tweened here — angle is driven every frame by
    // updateSway() (ambient wind), so the two compose instead of fighting;
    // no killTweensOf/angle reset needed since no tween ever targets angle.
    this.scene.tweens.add({
      targets: this.pivot,
      scale: 0,
      alpha: 0,
      duration: HARVEST_POP_MS,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        // Only NOW — fully hidden, tween complete — may this slot's visual
        // move on to EMPTY/BAGGED for the next growth cycle (see
        // OrchardTreeLayer.sync()'s isPoppingOut() guard, which is what
        // kept the exact clicked apple frozen/unswapped for the whole
        // animation above).
        this.poppingOut = false;
        this.consumed = false;
        this.apple.setVisible(false);
        this.bag.setVisible(false);
        this.setExceptional(false);
      },
    });
  }

  /**
   * Ambient secondary sway, driven every frame from this fruit's own tree's
   * CURRENT canopy angle (not the raw wind directly) — "inherits canopy
   * movement, plus a bit more" — rather than a one-off tween. Composes
   * cleanly with the scale/alpha tweens above since this is the only thing
   * that ever touches `angle`. Runs regardless of reveal/harvest state
   * (harmless while invisible) so a fruit never "catches up" or snaps when
   * it reappears.
   * @param canopyAngleDeg this fruit's own tree's current windPivot angle
   *   (already includes that tree's own amplitude/response variation); the
   *   fruit's own slower response rate is what makes it visibly lag behind
   *   the canopy rather than track it 1:1.
   */
  updateSway(canopyAngleDeg: number, dtSeconds: number): void {
    const target = (canopyAngleDeg / CANOPY_SWAY_MAX_DEG) * FRUIT_SWAY_MAX_DEG * this.swayAmpScale;
    const alpha = 1 - Math.exp(-this.swayResponseRate * dtSeconds);
    this.swayAngle += (target - this.swayAngle) * alpha;
    this.pivot.setAngle(this.swayAngle);
  }
}

/**
 * One tree: a stationary root (world position/scale, aligned to the baked
 * trunk in orchard_background.png — "rooted in the ground") holding a
 * `windPivot` that carries the canopy image and every FruitSlot. Rotating
 * `windPivot` sways canopy + fruit together as one rigid gust push; each
 * FruitSlot then layers its own smaller secondary sway (see
 * FruitSlot.updateSway) on top via its own local `angle`, so the two
 * rotations compose (parent windPivot angle + child pivot angle) without
 * either overwriting the other.
 */
class TreeNode {
  readonly container: Phaser.GameObjects.Container;
  private readonly windPivot: Phaser.GameObjects.Container;
  readonly slots: FruitSlot[];
  private canopyAngle = 0;
  // Rolled ONCE at construction — see the tuning block near the top of this
  // file. No per-tree phase/time-shift anymore: every tree targets the
  // exact same wind.value, differing only in how strongly (ampScale) and
  // how quickly (responseRate) it eases toward that shared target.
  private readonly ampScale = rand(TREE_AMP_SCALE_MIN, TREE_AMP_SCALE_MAX);
  private readonly responseRate = rand(TREE_RESPONSE_RATE_MIN, TREE_RESPONSE_RATE_MAX);

  constructor(scene: Phaser.Scene, layout: TreeLayoutSlot, hooks: HarvestHooks, treeIndex: number) {
    this.container = scene.add.container(layout.x, layout.groundY);
    this.container.setScale(layout.scale);

    // Trunk/roots/ground-shadow are now baked into orchard_background.png
    // (the landscape layer, drawn beneath this whole tree layer) — no
    // procedural trunk graphic here anymore. The stationary root container
    // above still exists purely to hold windPivot at the correct
    // world position; it draws nothing of its own.

    // Canopy + fruit: both live under windPivot so ambient sway rotates
    // them together, while gameplay reveal/pop tweens (scale/alpha only,
    // see FruitSlot) are untouched by it.
    this.windPivot = scene.add.container(0, 0);
    this.container.add(this.windPivot);

    // Canopy image: one shared texture/display size for all 5 trees (HARD
    // REQUIREMENT — see PROJECT.md "Canopy Layer V1" section G). origin.y =
    // CANOPY_ANCHOR_FRAC places the leaf mass's own measured bottom-center
    // exactly at this tree's canopyOffsetY, plus this tree's OWN ROW's
    // downward nudge (CANOPY_VERTICAL_NUDGE_FRONT_PX / _BACK_PX — no longer
    // one shared constant, see the RETUNE 4 comment above) — never captures
    // pointer input.
    const rowNudge = layout.row === 'back' ? CANOPY_VERTICAL_NUDGE_BACK_PX : CANOPY_VERTICAL_NUDGE_FRONT_PX;
    const canopyY = layout.canopyOffsetY + rowNudge;
    // Per-tree canopy offset (see BACK_LEFT_/BACK_RIGHT_/FRONT_LEFT_/CENTER_/
    // FRONT_RIGHT_CANOPY_OFFSET above) — applied to BOTH the canopy image's
    // own local position AND the fruit anchors below (same offsetX/offsetY),
    // so a tree's apples move by the exact same amount as its canopy and
    // FruitSlot hit areas stay centered on the visible fruit. TREE_LAYOUT's
    // own x/groundY/canopyOffsetY and the row nudge above are untouched.
    const canopyOffset = CANOPY_OFFSET_BY_INDEX[treeIndex];
    const canopyDrawY = canopyY + canopyOffset.y;
    const canopy = scene.add.image(canopyOffset.x, canopyDrawY, ORCHARD_CANOPY_KEY);
    canopy.setOrigin(0.5, CANOPY_ANCHOR_FRAC);
    canopy.setDisplaySize(CANOPY_DISPLAY_W, CANOPY_DISPLAY_H);
    if (layout.flip) canopy.setFlipX(true);
    // Canopy-only subtle color tone-down (see CANOPY_COLOR_TINT above) —
    // apples, background, sky/clouds, and UI are separate Game Objects and
    // are never touched by this.
    canopy.setTint(CANOPY_COLOR_TINT);
    this.windPivot.add(canopy);

    const fruitOffsets = canopyFruitOffsets(canopyDrawY).map(
      ([ox, oy]): [number, number] => [ox + canopyOffset.x, oy],
    );
    this.slots = fruitOffsets.map(([ox, oy], waveIdx) => {
      const slot = new FruitSlot(scene, ox, oy, hooks, treeIndex * FRUIT_PER_TREE + waveIdx);
      this.windPivot.add(slot.pivot);
      return slot;
    });
  }

  /**
   * Advances this tree's own canopy sway — eased toward the SAME shared
   * `wind.value` every tree targets, at this tree's own small
   * amplitude/response variation — plus a small horizontal drift in the
   * same direction (both derived from the one shared signal, so they never
   * disagree), and every one of its fruit's secondary sway. Called once
   * per real frame from OrchardTreeLayer.sync().
   */
  updateSway(wind: WindModel, dtSeconds: number): void {
    const target = wind.value * CANOPY_SWAY_MAX_DEG * this.ampScale;
    const alpha = 1 - Math.exp(-this.responseRate * dtSeconds);
    this.canopyAngle += (target - this.canopyAngle) * alpha;
    this.windPivot.setAngle(this.canopyAngle);
    this.windPivot.x = (this.canopyAngle / CANOPY_SWAY_MAX_DEG) * CANOPY_DRIFT_MAX_PX;
    this.slots.forEach((slot) => slot.updateSway(this.canopyAngle, dtSeconds));
  }
}

/**
 * Persistent 5-tree orchard visual (2 back, 3 front). Lives for the whole
 * OrchardScreen lifetime — unlike the rest of the screen, it is never
 * torn down and rebuilt on each render() poll, since fruit-reveal and
 * sway animations need to keep running smoothly between polls.
 *
 * Each of the 15 physical FruitSlot visuals maps 1:1 (by flat index, tree
 * order x wave order) to the currently-displayed Field's own
 * `field.slots[i]` logical state, which is what actually owns
 * ripe/growing/timer state now — this layer just mirrors it and reports
 * individual harvests back up.
 */
export class OrchardTreeLayer extends Phaser.GameObjects.Container {
  private trees: TreeNode[];
  private allSlots: FruitSlot[];
  private lastIdentityKey = '';
  // Per-slot identity of whatever visual/size was last drawn on it (a
  // Specimen id, or the planted Line's own id+rounded size) — lets a
  // Specimen's own distinct apple illustration override the field's normal
  // fruit on just that one slot, and revert once it's harvested/regrown as
  // ordinary fruit, without re-drawing all 15 slots on every sync() call.
  private lastSlotVisualKey: string[];
  // Per-slot presentation bookkeeping for the EMPTY -> BAGGED -> RIPE stage
  // split (see GROW_EMPTY_FRACTION above) — growCycleTotal[i] is the
  // best-known total duration of slot i's CURRENT regrow cycle (captured
  // the first time that cycle is observed, from the slot's own live
  // timer — never a separately tracked/authoritative duration), and
  // lastStage[i] is the stage last applied to that slot's visual, so
  // sync() only re-triggers a stage transition when it actually changes.
  private growCycleTotal: number[];
  private lastStage: FruitStage[];
  private currentField: Field | null = null;
  private game: Game;
  // True while the primary pointer is held down, tracked globally (scene
  // input, not any one fruit) so a press that starts on empty grass and
  // then drags onto fruit still harvests them.
  private sweepActive = false;
  // Single shared ambient wind for the whole Orchard (see render/orchardWind.ts)
  // — one instance, advanced once per sync() call, sampled by every tree/fruit.
  private wind = new WindModel();

  constructor(scene: Phaser.Scene, game: Game) {
    super(scene, 0, 0);
    this.game = game;

    // Harvesting never awards cash directly — it only enqueues the apple
    // onto the shared farm-wide processing queue (see Game.harvestFruitSlot
    // / GameState.processingQueue). Shipment/cash feedback is driven
    // separately, from Game's 'shipment' events (see OrchardScreen).
    // Game.harvestFruitSlot's own boolean return is passed straight
    // through so FruitSlot can decline the pop animation when the Packing
    // Box is full (see PROJECT.md "Shipping Infrastructure").
    const hooks: HarvestHooks = {
      attemptHarvest: (slotIndex: number) => {
        if (!this.currentField) return false;
        return this.game.harvestFruitSlot(this.currentField.id, slotIndex);
      },
    };

    this.trees = TREE_LAYOUT.map((layout, i) => {
      const tree = new TreeNode(scene, layout, hooks, i);
      this.add(tree.container);
      return tree;
    });
    this.allSlots = this.trees.flatMap((tree) => tree.slots);
    this.lastSlotVisualKey = new Array(this.allSlots.length).fill('');
    this.growCycleTotal = new Array(this.allSlots.length).fill(0);
    this.lastStage = new Array(this.allSlots.length).fill('EMPTY');
    scene.add.existing(this);

    // Global hold-and-sweep: track primary-pointer state at the scene
    // level (not per-fruit) so pressing down on empty orchard space and
    // then dragging onto fruit still collects them. Releasing anywhere,
    // including outside any fruit, ends sweep mode.
    scene.input.on('pointerdown', () => {
      this.sweepActive = true;
    });
    scene.input.on('pointerup', () => {
      this.sweepActive = false;
    });
    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.sweepActive) return;
      const hits = scene.input.hitTestPointer(pointer);
      for (const hit of hits) {
        const slot = this.allSlots.find((s) => s.pivot === hit);
        if (slot) slot.attemptHarvest();
      }
    });
  }

  /** HARVEST ALL convenience button: pops every currently ripe fruit (zero, some, or all 15) — does not require the full 15 to be ripe. */
  harvestAllRemaining(): void {
    this.allSlots.forEach((slot) => slot.attemptHarvest());
  }

  /** Verification-only: count of currently-revealed fruit slots, used by browser-driven checks. Not used by any gameplay path. */
  debugRevealedCount(): number {
    return this.allSlots.filter((slot) => slot.revealed).length;
  }

  /**
   * Presentation stage for slot i, purely derived from the field's own
   * live `active`/`ripe`/`timer` state (see FieldFruitSlot) — never reads
   * or writes anything gameplay-facing. `growCycleTotal[i]` is updated as
   * a side effect: whenever the slot is growing and its remaining timer is
   * HIGHER than the last-recorded total, a fresh regrow cycle must have
   * just started (the timer only ever counts down within one cycle), so
   * the new value becomes the total that EMPTY/BAGGED elapsed-fraction is
   * measured against.
   */
  private stageForSlot(s: FieldFruitSlot, i: number): FruitStage {
    if (!s.active) return 'EMPTY';
    if (s.ripe) return 'RIPE';
    if (s.timer > this.growCycleTotal[i] + 0.001) {
      this.growCycleTotal[i] = s.timer;
    }
    const total = this.growCycleTotal[i];
    const elapsedFraction = total > 0 ? 1 - s.timer / total : 1;
    return elapsedFraction < GROW_EMPTY_FRACTION ? 'EMPTY' : 'BAGGED';
  }

  /** Called every real frame; safe to call even while Orchard isn't the visible screen. */
  sync(field: Field, variety: Variety, dtSeconds: number): void {
    this.currentField = field;
    const eff = effectiveStats(variety, field.policy);
    const identityKey = `${field.id}:${variety.id}:${field.policy}`;
    const hardReset = identityKey !== this.lastIdentityKey;

    field.slots.forEach((s, i) => {
      const slot = this.allSlots[i];
      // Frozen mid-harvest-pop (see FruitSlot.attemptHarvest/isPoppingOut):
      // skip BOTH the identity redraw and the stage transition below for
      // this slot entirely until its disappear tween fully completes, so
      // the exact apple the player clicked can never be swapped out from
      // under it mid-animation (this was the cause of the harvest-disappear
      // color bug — see PROJECT.md).
      if (slot.isPoppingOut()) return;

      // Each slot shows either the planted Line's own visual, or — if it's
      // currently holding a special mutation fruit — that Specimen's own
      // visual/size instead (see PROJECT.md section 6: the player must be
      // able to physically notice a different apple among the ordinary
      // fruit). Only re-drawn when a slot's own identity actually changed
      // (Specimen appeared/was harvested, or a hard field/variety switch),
      // not every frame.
      const specimen = s.specimen;
      // Ordinary fruit always shows the Line's stable baseVisualId, never
      // its special identity visualId — a Rare/Epic lineage grows its
      // ordinary baseVisualId crop, with its own special Visual only ever
      // appearing as a physical Specimen fruit (see PROJECT.md "Revise
      // Rare / Epic Line behavior").
      const visualId = specimen ? specimen.visualId : variety.baseVisualId;
      const size = specimen ? specimen.size : eff.size;
      const key = specimen ? `specimen:${specimen.id}` : `line:${variety.id}:${Math.round(size)}`;
      if (hardReset || this.lastSlotVisualKey[i] !== key) {
        slot.setTraits(visualId, size);
        // Genetic Exceptional fruit is a normal production visual (see
        // PROJECT.md section 6), never a Visual Mutation — the ring is the
        // only thing distinguishing it on the tree (see section 12).
        slot.setExceptional(!!specimen?.exceptionalArchetype);
        this.lastSlotVisualKey[i] = key;
      }

      // EMPTY -> BAGGED -> RIPE presentation stage (see stageForSlot above).
      // Switching fields/variety (hardReset) snaps every slot straight to
      // its target stage with no replayed animation; otherwise a stage
      // change only ever animates forward (EMPTY->BAGGED, ->RIPE) — any
      // other change (e.g. Closing's own non-click auto-harvest making a
      // slot un-ripe) snaps instantly rather than double-animating on top
      // of a harvest-pop that already played (or, for a non-click harvest,
      // never played one to begin with).
      const stage = this.stageForSlot(s, i);
      if (hardReset) {
        slot.snapToStage(stage);
      } else if (stage !== this.lastStage[i]) {
        if (stage === 'BAGGED' || stage === 'RIPE') {
          slot.growInto(this.scene, stage);
        } else {
          slot.snapToStage(stage);
        }
      }
      this.lastStage[i] = stage;
    });

    // Ambient wind — advanced once here (never per-tree) so every tree/fruit
    // samples the exact same underlying signal; only ticks while sync() is
    // being called, i.e. while Orchard is relevant and the farm isn't
    // paused for Breed (see MainScene.update()), matching every other
    // Orchard-presentation timer in this file.
    this.wind.update(dtSeconds);
    this.trees.forEach((tree) => tree.updateSway(this.wind, dtSeconds));
    this.lastIdentityKey = identityKey;
  }

  /** DEV-only: skips straight to the next wind gust instead of waiting out its scheduled interval, so a browser check doesn't need to wait 10-25s. Never called from production/gameplay code. */
  debugTriggerWindGust(): void {
    this.wind.debugTriggerGust();
  }
}
