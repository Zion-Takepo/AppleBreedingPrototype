import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Field, Variety } from '../types.ts';
import { effectiveStats } from '../systems/economy.ts';
import { AppleVisual } from './AppleVisual.ts';

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

// 2 back-row trees (smaller, higher, peeking between the front row) + 3
// front-row trees (full size, dominant). Order matters: back row is added
// first so front row visually sits in front of it.
const TREE_LAYOUT: TreeLayoutSlot[] = [
  { x: 500, groundY: 300, scale: 0.84 },
  { x: 1100, groundY: 300, scale: 0.84 },
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

const GUST_MIN_S = 3;
const GUST_MAX_S = 6;
const GUST_ANGLE_MIN_DEG = 8;
const GUST_ANGLE_MAX_DEG = 12;
const GUST_DURATION_MIN_MS = 1200;
const GUST_DURATION_MAX_MS = 1800;

const TREE_SWAY_MAX_DEG = 0.8;
const TREE_SWAY_HALF_CYCLE_MS = 3400;

// Direct-harvest tuning.
const HIT_RADIUS = FRUIT_PIVOT_RADIUS + 16; // slightly larger than the apple itself
const HARVEST_POP_MS = 200;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
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
  revealed = false;
  private revealing = false;
  private consumed = false;
  private gustTimerS = rand(GUST_MIN_S, GUST_MAX_S);

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
    this.scene.tweens.killTweensOf(this.pivot);
    this.pivot.setAngle(0);
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

  tickGust(scene: Phaser.Scene, dtSeconds: number): void {
    if (!this.revealed) return;
    this.gustTimerS -= dtSeconds;
    if (this.gustTimerS > 0) return;
    this.gustTimerS = rand(GUST_MIN_S, GUST_MAX_S);

    const gustAngle = rand(GUST_ANGLE_MIN_DEG, GUST_ANGLE_MAX_DEG) * (Math.random() < 0.5 ? -1 : 1);
    const settleDuration = rand(GUST_DURATION_MIN_MS, GUST_DURATION_MAX_MS);
    // Quick push from the gust, then a damped pendulum-like swing back to rest.
    scene.tweens.add({
      targets: this.pivot,
      angle: gustAngle,
      duration: 120,
      ease: 'Sine.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: this.pivot,
          angle: 0,
          duration: settleDuration,
          ease: 'Elastic.easeOut',
          easeParams: [1, 0.35],
        });
      },
    });
  }
}

/** One tree: trunk + canopy (static) plus 3 FruitSlots. */
class TreeNode {
  readonly container: Phaser.GameObjects.Container;
  readonly slots: FruitSlot[];

  constructor(scene: Phaser.Scene, layout: TreeLayoutSlot, swayDelayMs: number, hooks: HarvestHooks, treeIndex: number) {
    this.container = scene.add.container(layout.x, layout.groundY);
    this.container.setScale(layout.scale);

    const g = scene.add.graphics();
    g.fillStyle(0x6b4a2b, 1);
    g.fillRect(-12, -60, 24, 80);
    g.fillStyle(0x3f7a30, 1);
    g.fillCircle(0, -120, 108);
    g.fillCircle(-68, -80, 72);
    g.fillCircle(68, -80, 72);
    this.container.add(g);

    this.slots = FRUIT_SLOT_OFFSETS.map(([ox, oy], waveIdx) => {
      const slot = new FruitSlot(scene, ox, oy, hooks, treeIndex * FRUIT_PER_TREE + waveIdx);
      this.container.add(slot.pivot);
      return slot;
    });

    // Optional, very subtle continuous sway, phase-shifted per tree.
    scene.time.delayedCall(swayDelayMs, () => {
      scene.tweens.add({
        targets: this.container,
        angle: TREE_SWAY_MAX_DEG,
        duration: TREE_SWAY_HALF_CYCLE_MS,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    });
  }

  tickGustAll(scene: Phaser.Scene, dtSeconds: number): void {
    this.slots.forEach((slot) => slot.tickGust(scene, dtSeconds));
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
      const tree = new TreeNode(scene, layout, i * 620, hooks, i);
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

    this.trees.forEach((tree) => tree.tickGustAll(this.scene, dtSeconds));
    this.lastIdentityKey = identityKey;
  }
}
