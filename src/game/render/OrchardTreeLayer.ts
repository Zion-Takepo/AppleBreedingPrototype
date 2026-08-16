import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Field, Variety } from '../types.ts';
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
const TREE_LAYOUT: TreeLayoutSlot[] = [
  { x: 500, groundY: 280, scale: 1.0 },
  { x: 1100, groundY: 280, scale: 1.0 },
  { x: 240, groundY: 356, scale: 1.0 },
  { x: 800, groundY: 356, scale: 1.0 },
  { x: 1360, groundY: 356, scale: 1.0 },
];
// 5 trees x 3 slots = 15, matching TUNING.FRUIT_PER_BATCH — decoupled by
// design (this file is presentation-only), but the two must agree.
const FRUIT_PER_TREE = 3;

// Triangle of fruit slots, relative to a tree's local origin (ground/trunk
// base). Spaced further apart than the original version so each apple
// reads as distinct fruit, while staying inside the canopy silhouette.
const FRUIT_SLOT_OFFSETS: [number, number][] = [
  [0, -168],
  [-60, -84],
  [60, -84],
];

const ORCHARD_APPLE_BASE_PX = 80;
const FRUIT_PIVOT_RADIUS = ORCHARD_APPLE_BASE_PX / 2;

const REVEAL_POP_MS = 200;
const REVEAL_SETTLE_MS = 300;

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
const CANOPY_SWAY_MAX_DEG = 2.9; // ~1.8x the original 1.6deg — normal breeze should read as clearly alive
const CANOPY_DRIFT_MAX_PX = 5; // small horizontal lean alongside the rotation, same direction, same shared signal
const TREE_AMP_SCALE_MIN = 0.9; // ±10% — was ±18%; kept small so the shared wind stays the obvious primary driver
const TREE_AMP_SCALE_MAX = 1.1;
const TREE_RESPONSE_RATE_MIN = 5; // higher = snappier; ~0.05-0.20s settle lag between trees (was ~0.5-0.8s — too slow, read as separate cycles)
const TREE_RESPONSE_RATE_MAX = 20;

// Fruit: inherits the canopy's rotation for free (it's a child of the same
// windPivot) plus its own small secondary pendulum sway, proportional to
// THIS tree's own current canopy angle (so it stays "the canopy, plus a
// bit more") and eased in more slowly than the canopy itself so it visibly
// lags — a filter-lag effect, not a literal delay timer.
const FRUIT_SWAY_MAX_DEG = 4.2; // ~1.9x the original 2.2deg
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

  showInstantly(): void {
    this.revealed = true;
    this.revealing = false;
    this.consumed = false;
    this.pivot.setScale(1);
    this.pivot.setAlpha(1);
    this.pivot.setAngle(0);
  }

  hideInstantly(): void {
    this.revealed = false;
    this.revealing = false;
    this.consumed = false;
    this.pivot.setScale(0);
    this.pivot.setAlpha(0);
    this.pivot.setAngle(0);
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
    // Only scale/alpha are tweened here — angle is driven every frame by
    // updateSway() (ambient wind), so the two compose instead of fighting;
    // no killTweensOf/angle reset needed since no tween ever targets angle.
    this.scene.tweens.add({
      targets: this.pivot,
      scale: 0,
      alpha: 0,
      duration: HARVEST_POP_MS,
      ease: 'Cubic.easeIn',
    });
  }

  reveal(scene: Phaser.Scene): void {
    if (this.revealed || this.revealing) return;
    this.revealing = true;
    this.pivot.setScale(0);
    this.pivot.setAlpha(0.4);
    this.pivot.setAngle(0);
    // small -> expands (slight overshoot) -> settles, ~0.5s total.
    scene.tweens.add({
      targets: this.pivot,
      scale: 1.08,
      alpha: 0.9,
      duration: REVEAL_POP_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: this.pivot,
          scale: 1.0,
          alpha: 1,
          duration: REVEAL_SETTLE_MS,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            this.revealing = false;
            this.revealed = true;
            // A freshly regrown fruit must always be harvestable again —
            // without this, a slot harvested once (consumed=true) would
            // stay stuck un-harvestable forever since hardReset (the old
            // place `consumed` got cleared) no longer happens every cycle.
            this.consumed = false;
          },
        });
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
 * One tree: a stationary root (world position/scale + trunk — "rooted in
 * the ground") holding a `windPivot` that carries the canopy graphics and
 * every FruitSlot. Rotating `windPivot` sways canopy + fruit together as one
 * rigid gust push; each FruitSlot then layers its own smaller secondary
 * sway (see FruitSlot.updateSway) on top via its own local `angle`, so the
 * two rotations compose (parent windPivot angle + child pivot angle)
 * without either overwriting the other.
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

    // Trunk: stays directly on the stationary root container — nearly
    // motionless regardless of wind, so the tree still reads as rooted.
    const trunk = scene.add.graphics();
    trunk.fillStyle(0x6b4a2b, 1);
    trunk.fillRect(-12, -60, 24, 80);
    this.container.add(trunk);

    // Canopy + fruit: both live under windPivot so ambient sway rotates
    // them together, while gameplay reveal/pop tweens (scale/alpha only,
    // see FruitSlot) are untouched by it.
    this.windPivot = scene.add.container(0, 0);
    this.container.add(this.windPivot);

    const canopy = scene.add.graphics();
    canopy.fillStyle(0x3f7a30, 1);
    canopy.fillCircle(0, -120, 108);
    canopy.fillCircle(-68, -80, 72);
    canopy.fillCircle(68, -80, 72);
    this.windPivot.add(canopy);

    this.slots = FRUIT_SLOT_OFFSETS.map(([ox, oy], waveIdx) => {
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

  /** Called every real frame; safe to call even while Orchard isn't the visible screen. */
  sync(field: Field, variety: Variety, dtSeconds: number): void {
    this.currentField = field;
    const eff = effectiveStats(variety, field.policy);
    const identityKey = `${field.id}:${variety.id}:${field.policy}`;
    const hardReset = identityKey !== this.lastIdentityKey;

    // Each slot shows either the planted Line's own visual, or — if it's
    // currently holding a special mutation fruit — that Specimen's own
    // visual/size instead (see PROJECT.md section 6: the player must be
    // able to physically notice a different apple among the ordinary
    // fruit). Only re-drawn when a slot's own identity actually changed
    // (Specimen appeared/was harvested, or a hard field/variety switch),
    // not every frame.
    field.slots.forEach((s, i) => {
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
        this.allSlots[i].setTraits(visualId, size);
        // Genetic Exceptional fruit is a normal production visual (see
        // PROJECT.md section 6), never a Visual Mutation — the ring is the
        // only thing distinguishing it on the tree (see section 12).
        this.allSlots[i].setExceptional(!!specimen?.exceptionalArchetype);
        this.lastSlotVisualKey[i] = key;
      }
    });

    if (hardReset) {
      // Switching fields/variety: snap every slot straight to this field's
      // actual per-slot state — no replaying grow animations for fruit
      // that ripened while this field was in the background, and no
      // regenerating fruit that was already individually harvested.
      field.slots.forEach((s, i) => (s.ripe ? this.allSlots[i].showInstantly() : this.allSlots[i].hideInstantly()));
    } else {
      field.slots.forEach((s, i) => {
        const slot = this.allSlots[i];
        if (s.ripe && !slot.revealed) slot.reveal(this.scene);
      });
    }

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
