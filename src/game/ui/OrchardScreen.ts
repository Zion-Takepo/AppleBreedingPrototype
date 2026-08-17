import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { CultivationPolicy, Field, Variety } from '../types.ts';
import { effectiveStats } from '../systems/economy.ts';
import { TUNING } from '../tuning.ts';
import { OrchardTreeLayer } from '../render/OrchardTreeLayer.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { LAYOUT, ORCHARD, THEME } from './theme.ts';
import { Button, orchardFrame, text as mkText } from './uiKit.ts';
import { ToastQueue } from './modals.ts';
import { openVarietyPickerModal } from './varietyPicker.ts';
import { catalogLabel } from '../render/appleAssets.ts';
import { openShippingInfraModal } from './ShippingInfraModal.ts';
import { createStatInfoButton } from './StatHelpModal.ts';

// ------------------------------------------------------------------
// Orchard UI redesign (see PROJECT.md "Orchard UI redesign") — final
// presentation STRUCTURE using current placeholder art. No side walls, no
// full-width bars: a compact top-left Field card, a lower-left Stats card,
// and a lower-right Cultivation/Change-Variety/Packing/Harvest-All action
// card, leaving the central Orchard/landscape open. All layout tuning below
// is presentation-only.
// ------------------------------------------------------------------

// Orchard layered art V1 (see PROJECT.md "Canopy Layer V1" / the orchard
// visual-integration pass) — approved external painterly layers, each used
// exactly as supplied (no tinting/blurring/derivative processing). Exported
// so MainScene can load them under stable keys, the same pattern
// APPLE_ASSET_IDS/appleTextureKey/appleAssetPath already use for the apple
// illustrations.
//
// orchard_background.png now holds ONLY the landscape + 5 baked trunks/
// roots/ground-shadows (transparent sky region) — sky and clouds are their
// own separate layers below, per the approved layering direction.
export const ORCHARD_BACKGROUND_KEY = 'orchard-background';
export const ORCHARD_BACKGROUND_PATH = 'assets/orchard/orchard_background.png';
export const ORCHARD_SKY_KEY = 'orchard-sky';
export const ORCHARD_SKY_PATH = 'assets/orchard/orchard_sky_day_v1.png';
export const ORCHARD_CLOUD_KEY = 'orchard-cloud';
export const ORCHARD_CLOUD_PATH = 'assets/orchard/orchard_cloud.png';

// Stats card frame (premium cream/parchment + gold plaque) — a NineSlice
// asset replacing only the Graphics fill/border the Stats card used to draw
// itself. Pre-cropped to its opaque bounds and downscaled 1920x526 ->
// 336x92 (uniform 0.175 scale) offline so the corner ornament (rounded
// "eared" corner + leaf motif) samples at roughly the same pixel density it
// will actually be displayed at — see SC_FRAME_BORDER below for how the
// slice values were measured against this specific downscaled asset.
export const ORCHARD_STATS_FRAME_KEY = 'orchard-stats-frame';
export const ORCHARD_STATS_FRAME_PATH = 'assets/ui/orchard_stats_frame_9slice.png';

// Wind foreground foliage (visual experiment) — corner-anchored overhanging
// branch overlays so the wind reads across the whole scene rather than only
// the apple trees swaying. Non-interactive, drawn in front of the
// background/trees but behind all UI (see the Container add() order in the
// constructor) — see FOLIAGE_LAYERS below for placement/sway tuning.
// Bottom-left/bottom-right corner foliage was tried and removed; top-left and
// top-right are the only layers. Do not reintroduce bottom foliage.
export const WIND_FOLIAGE_TOP_LEFT_KEY = 'wind-foliage-top-left';
export const WIND_FOLIAGE_TOP_LEFT_PATH = 'assets/orchard/wind/wind_foliage_top_left.png';
export const WIND_FOLIAGE_TOP_RIGHT_KEY = 'wind-foliage-top-right';
export const WIND_FOLIAGE_TOP_RIGHT_PATH = 'assets/orchard/wind/wind_foliage_top_right.png';

// Cloud drift (see PROJECT.md orchard visual-integration pass) — very slow,
// constant horizontal drift only (no vertical bob/scale/rotation/parallax).
// Two instances of the same cloud texture, placed edge-to-edge and both
// shifted left together, wrapped with modulo — since both instances are the
// identical artwork, the wrap point is invisible (no hard reset/teleport).
// ~230s to fully traverse one screen width is deliberately subtle ("notice
// after spending some time," not obvious scrolling).
const CLOUD_DISPLAY_W = LAYOUT.width;
const CLOUD_DISPLAY_H = LAYOUT.height;
const CLOUD_TRAVERSAL_SECONDS = 230;
const CLOUD_DRIFT_PX_PER_SEC = CLOUD_DISPLAY_W / CLOUD_TRAVERSAL_SECONDS;

// Background "breathing" drift (visual experiment) — very subtle continuous
// motion on ONLY the static landscape/trunks image (`this.background`), so
// it doesn't read as a completely frozen painting now that sky/clouds/
// canopies all move. Three independent, incommensurate periods (same
// "avoid a repetitive single-oscillator look" idea `orchardWind.ts` already
// uses for canopy sway) drifted with plain sine waves — continuous velocity
// through zero, i.e. already Sine.easeInOut-equivalent, no linear snap.
// Ticked from updateTrees() below, so it shares the exact same Breed-pause
// gating (MainScene.update()'s `farmPaused` check) every other Orchard
// ambient-motion timer already uses — never advances while Breed is active,
// never catches up on resume.
const BG_DRIFT_X_PX = 4;
const BG_DRIFT_Y_PX = 2;
const BG_DRIFT_X_PERIOD_S = 18;
const BG_DRIFT_Y_PERIOD_S = 14;
const BG_SCALE_AMPLITUDE = 0.004; // +-0.4% around the fitted base scale
const BG_SCALE_PERIOD_S = 20;
// Base overscan so the drifted/scaled image edges never reveal a
// transparent gap at the 1600x900 canvas edges even at the worst-case
// simultaneous extreme (max drift + max shrink at once): needs >=0.9%
// (driven by the horizontal 4px drift), 1.5% picked for a small safety
// margin — not a material zoom of the composition.
const BG_OVERSCAN = 1.015;

// Wind foreground foliage placement/sway (visual experiment). Coordinates
// below are in absolute 1600x900 canvas space (converted to this
// Container's own local space the same way sky/clouds/background already
// are, by subtracting LAYOUT.contentTop from y at construction time) so
// they line up with the rest of the corner-anchored layout math in this
// file. Each layer's origin sits at the corner its "root" should read as
// growing from off-screen — top-left pivots at its own top-left corner —
// combined with a small negative position offset (pushing that corner a
// little past the canvas edge) so the branch base is never visibly cut off
// mid-shape, it just isn't there. Since the pivot itself sits just
// off-canvas and only ever jitters by under a px around that offset (never
// crossing back onto the visible canvas), the small rotation/x-sway below
// can never open a gap between the branch and the screen border.
//
// Both foliage layers now sample ONE shared wind signal (`sampleFoliageWind`
// below) rather than each defining its own independent sine periods/phases —
// the exact same "one shared breeze, small per-instance variation" pattern
// `orchardWind.ts`/`OrchardTreeLayer.ts` already uses for the 5 canopies
// (every tree samples the identical `wind.value`, then applies only a small
// per-tree amplitude scale and settle-lag rolled once at construction — see
// PROJECT.md "Living Orchard Motion Prototype"). Each layer's own
// `ampScale`/`responseLagS` are that same kind of small, fixed-at-authoring
// variation: `ampScale` scales the shared signal's amplitude a little,
// `responseLagS` samples the shared signal slightly in the past (as if that
// side's leaves settle a beat later) — never a second independent
// oscillator, never a random per-frame offset, so both layers still
// generally lean the same direction at the same time.
//
// The shared signal itself sums two slow, close-but-incommensurate sine
// periods (same "avoid a repetitive single-oscillator look" idea
// orchardWind.ts uses for canopy sway) so the swing amplitude slowly
// breathes between roughly its two component amplitudes over a long
// (~30s+) beat instead of repeating on a fixed metronome — deliberately
// calm, meant to read as "the leaves are responding to wind" without the
// overlay's own motion ever being consciously noticed.
const FOLIAGE_ROT_AMP_DEG = 0.2;
const FOLIAGE_ROT_PERIOD_S = 6.0;
const FOLIAGE_ROT_PHASE = 0;
const FOLIAGE_ROT_AMP_DEG_2 = 0.1;
const FOLIAGE_ROT_PERIOD_S_2 = 7.4;
const FOLIAGE_ROT_PHASE_2 = 1.7;
const FOLIAGE_X_AMP_PX = 0.75;
const FOLIAGE_X_PERIOD_S = 6.6;
const FOLIAGE_X_PHASE = 0.8;

/** The one shared wind-foliage signal both corner layers sample (see above). */
function sampleFoliageWind(t: number): { angle: number; offsetX: number } {
  const angle =
    FOLIAGE_ROT_AMP_DEG * Math.sin((2 * Math.PI * t) / FOLIAGE_ROT_PERIOD_S + FOLIAGE_ROT_PHASE) +
    FOLIAGE_ROT_AMP_DEG_2 * Math.sin((2 * Math.PI * t) / FOLIAGE_ROT_PERIOD_S_2 + FOLIAGE_ROT_PHASE_2);
  const offsetX = FOLIAGE_X_AMP_PX * Math.sin((2 * Math.PI * t) / FOLIAGE_X_PERIOD_S + FOLIAGE_X_PHASE);
  return { angle, offsetX };
}

type FoliageLayerConfig = {
  key: string;
  originX: number;
  originY: number;
  x: number;
  y: number;
  displayW: number;
  displayH: number;
  // Small per-side variation on top of the one shared signal above — see
  // the comment block above for why these exist instead of a second
  // independent oscillator.
  ampScale: number;
  responseLagS: number;
};

const FOLIAGE_LAYERS: FoliageLayerConfig[] = [
  // Top-left overhanging branch/leaves — the original/approved layer.
  // ampScale 1 / responseLagS 0 means it samples the shared signal exactly
  // as-is, so its motion is unchanged from before this pass.
  {
    key: WIND_FOLIAGE_TOP_LEFT_KEY,
    originX: 0,
    originY: 0,
    x: -24,
    y: -20,
    displayW: 480,
    displayH: 360,
    ampScale: 1,
    responseLagS: 0,
  },
  // Top-right overhanging branch/leaves — same corner-anchoring approach as
  // top-left (own top-right corner pivot, pushed slightly past the canvas
  // edge). Position/size/depth/origin/artwork unchanged from the prior
  // pass. Samples the SAME shared wind signal as top-left, scaled 0.9x
  // (10% softer, within the requested +-10-15% band) and time-lagged 0.15s
  // (within the same 0.05-0.20s settle-lag range OrchardTreeLayer.ts already
  // uses per-tree) so it reads as "the same breeze, responding a beat later
  // and a little softer" rather than a synchronized mirror or an unrelated
  // second oscillator. Never increases global wind amplitude — ampScale
  // here is < 1, and the underlying shared constants above are untouched.
  {
    key: WIND_FOLIAGE_TOP_RIGHT_KEY,
    originX: 1,
    originY: 0,
    x: LAYOUT.width + 24,
    y: -20,
    displayW: 480,
    displayH: 360,
    ampScale: 0.9,
    responseLagS: 0.15,
  },
];

// Field card (top-left) — a small secondary label plus a compact
// deep-forest pill (current Line + dropdown) and a separate cream/gold
// "+ FIELD" button beside it, rather than one large cream panel.
const FC_X = 16;
const FC_Y = 8;
const FC_ROW_Y = FC_Y + 20;
const FC_ROW_H = 40;
const FC_ICON_PX = 24;
const FC_PILL_PAD_X = 12;
// The pill itself is content-width (auto-sized to the Line name); the
// dropdown popup below it still needs a fixed, comfortably-readable width.
const FC_DROPDOWN_W = 280;

// Shared "secondary" tone for controls that are deliberately subordinate to
// the deep-forest primary actions and the gold END DAY/HARVEST ALL accent —
// Cultivation's unselected segments and CHANGE VARIETY (see fixes #3/#4).
const SECONDARY_BG = ORCHARD.mutedCream;

// Styling pass (see PROJECT.md "Orchard UI Final Structure + Styling Pass"
// section 5 "LOWER UI SAFE ZONE"): both lower cards share one bottom
// alignment target, ~absolute y 820 — just above where BottomNav's own
// visible bar now sits (moved down within its existing reserved band, see
// BottomNav.ts BAR_Y/BAR_H), leaving a clean gap before the Nav without
// widening LAYOUT.navHeight/contentBottom itself.
const LOWER_CARD_BOTTOM = LAYOUT.contentHeight + 8;

// Lower-left Stats card
const SC_X = 28;
const SC_W = 460;
const SC_H = 114;
// NineSlice border sizes for ORCHARD_STATS_FRAME_KEY, measured directly off
// the 336x92 downscaled asset (corner rounding + concave "ear" notch + leaf
// ornament fully contained inside each corner box, safe straight trim
// stretched everywhere else) — see the asset comment above for how the
// source was prepared.
const SC_FRAME_BORDER = { left: 37, right: 37, top: 40, bottom: 40 };

// Lower-right Orchard action card (top row: Change Variety + Packing;
// middle row: Cultivation segmented control; bottom row: Harvest All)
const AC_W = 460;
const AC_H = 140;
const AC_X = LAYOUT.width - 20 - AC_W;
const AC_PAD = 16;

type StatKey = 'sweetness' | 'size' | 'yield' | 'growth' | 'freshness';
const STAT_ORDER: { key: StatKey; label: string }[] = [
  { key: 'sweetness', label: 'SWEETNESS' },
  { key: 'size', label: 'SIZE' },
  { key: 'yield', label: 'YIELD' },
  { key: 'growth', label: 'GROWTH' },
  { key: 'freshness', label: 'FRESHNESS' },
];

/** Tiny minimal glyph per genetic stat — plain Graphics primitives, not final art (see PROJECT.md "ART BOUNDARY"), just compact UI iconography for the Stats card. */
function drawStatIcon(g: Phaser.GameObjects.Graphics, key: StatKey, cx: number, cy: number): void {
  switch (key) {
    case 'sweetness':
      g.fillStyle(ORCHARD.gold, 1);
      g.fillCircle(cx, cy, 10);
      break;
    case 'size':
      g.lineStyle(2, ORCHARD.forestMid, 0.9);
      g.strokeCircle(cx, cy, 11);
      g.strokeCircle(cx, cy, 5);
      break;
    case 'yield':
      g.fillStyle(ORCHARD.gold, 0.9);
      g.fillCircle(cx - 7, cy + 5, 4);
      g.fillCircle(cx + 7, cy + 5, 4);
      g.fillCircle(cx, cy - 6, 4);
      break;
    case 'growth':
      g.fillStyle(ORCHARD.forestMid, 0.9);
      g.fillTriangle(cx, cy - 10, cx - 9, cy + 7, cx + 9, cy + 7);
      break;
    case 'freshness':
      g.fillStyle(ORCHARD.forestMid, 0.25);
      g.fillEllipse(cx, cy, 20, 14);
      g.lineStyle(2, ORCHARD.forestMid, 0.9);
      g.strokeEllipse(cx, cy, 20, 14);
      break;
  }
}

export class OrchardScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private toasts: ToastQueue;
  private sky: Phaser.GameObjects.Image;
  private cloudA: Phaser.GameObjects.Image;
  private cloudB: Phaser.GameObjects.Image;
  private cloudOffsetPx = 0;
  private background: Phaser.GameObjects.Image;
  private backgroundBaseX = 0;
  private backgroundBaseY = 0;
  private backgroundElapsed = 0;
  private foliageLayers: { img: Phaser.GameObjects.Image; cfg: FoliageLayerConfig; baseX: number; baseY: number }[] = [];
  private foliageElapsed = 0;
  private treeLayer: OrchardTreeLayer;
  private fieldCard: Phaser.GameObjects.Container;
  private fieldDropdown: Phaser.GameObjects.Container;
  private mainView: Phaser.GameObjects.Container;
  private selectedFieldId = 1;
  private fieldDropdownOpen = false;
  private fieldCardHeight = 0;

  // mainView's buttons are kept alive across renders (rather than destroyed
  // and recreated every ~120ms by MainScene's periodic auto-refresh) so a
  // pointer resting on one doesn't get handed a brand-new GameObject every
  // tick — Phaser treats that as a fresh pointerover each time, which made
  // the hover highlight visibly flicker. They're only torn down and rebuilt
  // when the selected field or its planted variety actually changes;
  // otherwise each render() just updates their dynamic properties in place.
  private mainViewFieldId: number | null = null;
  private mainViewVarietyId: string | null = null;
  private changeVarietyBtn: Button | null = null;
  private cultivationBtns: { btn: Button; policy: CultivationPolicy }[] = [];
  private harvestBtn: Button | null = null;
  private statValueTexts: Phaser.GameObjects.Text[] = [];
  private packingText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, game: Game, toasts: ToastQueue) {
    super(scene, 0, LAYOUT.contentTop);
    this.game = game;
    this.toasts = toasts;
    // treeLayer is persistent (never torn down on render()) so fruit-reveal
    // and sway tweens can keep running smoothly between UI refreshes. Every
    // individual fruit harvest goes straight to Game.harvestFruitSlot,
    // which only enqueues it — the actual cash/shipment feedback moment
    // ('shipment' event, fired later from Game.update() once the apple
    // reaches the front of the shared farm-wide processing queue) is shown
    // next to the HUD cash card (see HUD.ts), not here.
    // Orchard Background V1: the approved external painterly image, used
    // exactly as supplied (see PROJECT.md "Orchard Background V1"). This
    // Container itself sits at local y = -contentTop below, so the
    // background needs the same negative offset to actually cover the full
    // 1600x900 logical canvas rather than just the sub-HUD content area.
    // setDisplaySize forces an exact 1600x900 fill — the source PNG
    // (1672x941) is already authored at this aspect ratio to well under 1%
    // tolerance, so this introduces no visible stretch. Never given
    // setInteractive(), so it cannot capture pointer input or block
    // fruit click/sweep. Scoped entirely to this Container (which is
    // shown/hidden as a whole by MainScene.showScreen) rather than the
    // global scene background, so it only ever appears on the ORCHARD
    // screen — Breed/Calendar/Collection keep their own current look
    // untouched.
    // SKY — bottom-most layer, full 1600x900, non-interactive, static for
    // this pass (no time-of-day recoloring yet — a later dedicated
    // atmosphere pass). Same offset/setDisplaySize approach as the
    // landscape background below.
    this.sky = scene.add.image(0, -LAYOUT.contentTop, ORCHARD_SKY_KEY).setOrigin(0, 0);
    this.sky.setDisplaySize(LAYOUT.width, LAYOUT.height);

    // CLOUDS — two instances of the same transparent cloud artwork,
    // edge-to-edge, drifted together (see CLOUD_DRIFT_PX_PER_SEC above).
    // Never interactive.
    this.cloudA = scene.add.image(0, -LAYOUT.contentTop, ORCHARD_CLOUD_KEY).setOrigin(0, 0);
    this.cloudA.setDisplaySize(CLOUD_DISPLAY_W, CLOUD_DISPLAY_H);
    this.cloudB = scene.add.image(CLOUD_DISPLAY_W, -LAYOUT.contentTop, ORCHARD_CLOUD_KEY).setOrigin(0, 0);
    this.cloudB.setDisplaySize(CLOUD_DISPLAY_W, CLOUD_DISPLAY_H);

    // LANDSCAPE + baked trunks/roots/shadows — the approved external
    // painterly layer (see PROJECT.md), used exactly as supplied. Never
    // interactive, so it cannot capture pointer input or block fruit
    // click/sweep.
    // Center-origin (rather than the other layers' top-left origin) so the
    // small overscan/drift/breathing-scale below expands and shifts evenly
    // around the canvas center instead of only ever growing off one edge.
    this.backgroundBaseX = LAYOUT.width / 2;
    this.backgroundBaseY = -LAYOUT.contentTop + LAYOUT.height / 2;
    this.background = scene.add.image(this.backgroundBaseX, this.backgroundBaseY, ORCHARD_BACKGROUND_KEY).setOrigin(0.5, 0.5);
    this.background.setDisplaySize(LAYOUT.width * BG_OVERSCAN, LAYOUT.height * BG_OVERSCAN);

    this.treeLayer = new OrchardTreeLayer(scene, game);

    // WIND FOREGROUND FOLIAGE — never interactive, so it cannot capture
    // pointer input or block fruit click/sweep. See FOLIAGE_LAYERS above
    // for exact placement/sway tuning.
    this.foliageLayers = FOLIAGE_LAYERS.map((cfg) => {
      const baseX = cfg.x;
      const baseY = cfg.y - LAYOUT.contentTop;
      const img = scene.add.image(baseX, baseY, cfg.key).setOrigin(cfg.originX, cfg.originY);
      img.setDisplaySize(cfg.displayW, cfg.displayH);
      return { img, cfg, baseX, baseY };
    });

    this.fieldCard = scene.add.container(0, 0);
    this.mainView = scene.add.container(0, 0);
    this.fieldDropdown = scene.add.container(0, 0);
    // Draw order: sky, clouds, landscape+trunks, then trees/canopies/fruit,
    // then the wind foreground foliage (in front of the background/trees,
    // behind all UI), then the field card, then the stats/action card
    // content, then the field dropdown popup topmost (so it never renders
    // underneath the card it opens from).
    this.add([
      this.sky,
      this.cloudA,
      this.cloudB,
      this.background,
      this.treeLayer,
      ...this.foliageLayers.map((f) => f.img),
      this.fieldCard,
      this.mainView,
      this.fieldDropdown,
    ]);
    scene.add.existing(this);
  }

  /**
   * Advances cloud drift by dtSeconds — called every real frame alongside
   * updateTrees() below (same persistent-timer pattern the Living Orchard
   * wind model already uses: only ticks while Orchard presentation is
   * relevant/not Breed-paused, never resets on screen switch, never
   * duplicates instances). Purely horizontal offset, wrapped with modulo so
   * the two identical cloud instances hand off seamlessly with no visible
   * jump.
   */
  private updateClouds(dtSeconds: number): void {
    this.cloudOffsetPx = (this.cloudOffsetPx + CLOUD_DRIFT_PX_PER_SEC * dtSeconds) % CLOUD_DISPLAY_W;
    this.cloudA.x = -this.cloudOffsetPx;
    this.cloudB.x = CLOUD_DISPLAY_W - this.cloudOffsetPx;
  }

  /**
   * Background "breathing" drift (see the BG_DRIFT_x / BG_SCALE_x constants
   * above) — moves and scales ONLY `this.background` a very small amount
   * around its base fitted position/size. Sky, clouds, canopy, apples, and
   * UI are untouched by this method entirely.
   */
  private updateBackgroundDrift(dtSeconds: number): void {
    this.backgroundElapsed += dtSeconds;
    const t = this.backgroundElapsed;
    const offsetX = BG_DRIFT_X_PX * Math.sin((2 * Math.PI * t) / BG_DRIFT_X_PERIOD_S);
    const offsetY = BG_DRIFT_Y_PX * Math.sin((2 * Math.PI * t) / BG_DRIFT_Y_PERIOD_S);
    const scaleMult = 1 + BG_SCALE_AMPLITUDE * Math.sin((2 * Math.PI * t) / BG_SCALE_PERIOD_S);
    this.background.setPosition(this.backgroundBaseX + offsetX, this.backgroundBaseY + offsetY);
    this.background.setDisplaySize(LAYOUT.width * BG_OVERSCAN * scaleMult, LAYOUT.height * BG_OVERSCAN * scaleMult);
  }

  /**
   * Wind foreground foliage sway (see FOLIAGE_LAYERS/sampleFoliageWind
   * above) — every layer samples the ONE shared wind signal, each applying
   * only its own small ampScale/responseLagS variation on top, so all
   * foliage layers stay tied to the same breeze rather than running
   * independent oscillators.
   */
  private updateForegroundFoliage(dtSeconds: number): void {
    this.foliageElapsed += dtSeconds;
    const t = this.foliageElapsed;
    for (const { img, cfg, baseX } of this.foliageLayers) {
      const { angle, offsetX } = sampleFoliageWind(t - cfg.responseLagS);
      img.setAngle(angle * cfg.ampScale);
      img.x = baseX + offsetX * cfg.ampScale;
    }
  }

  /** Verification-only: not used by any gameplay path. */
  debugRevealedCount(): number {
    return this.treeLayer.debugRevealedCount();
  }

  /** Verification-only: identical to clicking the HARVEST ALL button. */
  debugHarvestAll(): void {
    this.treeLayer.harvestAllRemaining();
  }

  /** DEV-only: forces the next Living Orchard wind gust to start immediately (see OrchardTreeLayer.debugTriggerWindGust). Reachable via window.__debugOrchard in dev builds; never called from production/gameplay code. */
  debugTriggerWindGust(): void {
    this.treeLayer.debugTriggerWindGust();
  }

  /** Called every real frame from MainScene.update() so fruit-reveal/sway/cloud-drift animations progress smoothly. */
  updateTrees(dtSeconds: number): void {
    this.updateClouds(dtSeconds);
    this.updateBackgroundDrift(dtSeconds);
    this.updateForegroundFoliage(dtSeconds);
    const field = this.game.getField(this.selectedFieldId);
    if (!field || !field.varietyId) return;
    const variety = this.game.getVariety(field.varietyId);
    if (!variety) return;
    this.treeLayer.sync(field, variety, dtSeconds);
  }

  render(): void {
    const state = this.game.state;
    if (!state.fields.find((f) => f.id === this.selectedFieldId)?.unlocked) {
      this.selectedFieldId = state.fields.find((f) => f.unlocked)!.id;
    }
    this.renderFieldCard();
    this.renderFieldDropdown();
    this.renderMain();
  }

  // ------------------------------------------------------------------
  // Field card (top-left, second row under the HUD) — a small secondary
  // "FIELD i/total" label plus a compact deep-forest pill (current Line +
  // dropdown) and a separate cream/gold "+ FIELD" button beside it, rather
  // than one large cream panel. Rebuilt on every render() call (cheap: a
  // handful of shapes/text, no hover-sensitive controls).
  // ------------------------------------------------------------------
  private renderFieldCard(): void {
    this.fieldCard.removeAll(true);
    const state = this.game.state;
    const unlockedFields = state.fields.filter((f) => f.unlocked).sort((a, b) => a.id - b.id);
    const field = this.game.getField(this.selectedFieldId);
    const variety = field?.varietyId ? this.game.getVariety(field.varietyId) : undefined;
    const idx = unlockedFields.findIndex((f) => f.id === this.selectedFieldId) + 1;
    const nextId = state.fields.find((f) => !f.unlocked)?.id;
    const showLineage = !!variety && variety.visualId !== variety.baseVisualId;

    // Small secondary label, plain text (no panel) directly over the sky.
    this.fieldCard.add(mkText(this.scene, FC_X, FC_Y, `FIELD ${idx} / ${unlockedFields.length}`, 13, ORCHARD.textDark, true, true));

    // Compact deep-forest pill: [apple icon] LINE NAME ▼ — sized to its own
    // content rather than a fixed panel width.
    const lineName = variety ? variety.customName : '— NO LINE —';
    const nameText = mkText(this.scene, 0, 0, `${lineName}  ▼`, 17, ORCHARD.textWarmLight, true);
    const pillW = FC_PILL_PAD_X + FC_ICON_PX + 8 + nameText.width + FC_PILL_PAD_X;

    const pillG = orchardFrame(this.scene, FC_X, FC_ROW_Y, pillW, FC_ROW_H, { radius: FC_ROW_H / 2, outerAlpha: 0.7, inner: false });
    this.fieldCard.add(pillG);

    if (variety) {
      const icon = new AppleVisual(this.scene, FC_X + FC_PILL_PAD_X + FC_ICON_PX / 2, FC_ROW_Y + FC_ROW_H / 2, FC_ICON_PX);
      icon.draw({ visualId: variety.baseVisualId, size: variety.size });
      this.fieldCard.add(icon);
    }
    nameText.setPosition(FC_X + FC_PILL_PAD_X + FC_ICON_PX + 8, FC_ROW_Y + FC_ROW_H / 2);
    nameText.setOrigin(0, 0.5);
    this.fieldCard.add(nameText);

    // Ripe indicator for the currently selected Field, preserved from the
    // old per-tab dot — now a small badge on the pill itself.
    if (field?.slots.some((s) => s.ripe)) {
      const dot = this.scene.add.circle(FC_X + pillW - 8, FC_ROW_Y, 7, 0xe0392b);
      dot.setStrokeStyle(2, 0xffffff);
      this.fieldCard.add(dot);
    }

    const pillZone = this.scene.add.zone(FC_X, FC_ROW_Y, pillW, FC_ROW_H).setOrigin(0, 0);
    pillZone.setInteractive({ useHandCursor: true });
    pillZone.on('pointerdown', () => {
      this.fieldDropdownOpen = !this.fieldDropdownOpen;
      this.renderFieldDropdown();
    });
    this.fieldCard.add(pillZone);

    // Separate compact "+ FIELD $cost" button beside the pill — warm
    // muted-cream / thin-gold-hairline styling, deliberately secondary to
    // END DAY's solid gold fill (see PROJECT.md gold-usage rule: gold is an
    // accent, not a general fill).
    let rightEdge = FC_X + pillW;
    if (nextId) {
      const price = this.priceForField(nextId);
      const addLabel = mkText(this.scene, 0, 0, `+ FIELD $${price}`, 16, ORCHARD.textDark, true);
      const addW = FC_PILL_PAD_X + addLabel.width + FC_PILL_PAD_X;
      const addX = rightEdge + 10;
      const addG = orchardFrame(this.scene, addX, FC_ROW_Y, addW, FC_ROW_H, { fill: ORCHARD.mutedCream, radius: FC_ROW_H / 2, outerAlpha: 0.85, inner: false });
      this.fieldCard.add(addG);
      addLabel.setPosition(addX + addW / 2, FC_ROW_Y + FC_ROW_H / 2);
      addLabel.setOrigin(0.5);
      this.fieldCard.add(addLabel);
      const zone = this.scene.add.zone(addX, FC_ROW_Y, addW, FC_ROW_H).setOrigin(0, 0);
      zone.setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.tryBuyField(nextId));
      this.fieldCard.add(zone);
      rightEdge = addX + addW;
    }

    let cursorY = FC_ROW_Y + FC_ROW_H + 8;
    if (showLineage && variety) {
      const note = `Growing ${catalogLabel(variety.baseVisualId)} (Special Lineage: ${catalogLabel(variety.visualId)})`;
      const noteText = mkText(this.scene, FC_X, cursorY, note, 12, ORCHARD.textDark, true);
      noteText.setWordWrapWidth(Math.max(rightEdge - FC_X, 260), true);
      this.fieldCard.add(noteText);
      cursorY += 22;
    }

    // Bottom edge of everything actually drawn (pill row + optional
    // lineage note) — used to position the dropdown popup directly below.
    this.fieldCardHeight = cursorY - FC_Y;
  }

  // Dropdown-style field switcher (see PROJECT.md "CURRENT FIELD CARD" —
  // "a compact selector / segmented control / dropdown-like interaction").
  // Kept in its own always-topmost container so it draws above the trees
  // and the field card itself. No outside-click-to-close exists anywhere
  // else in this codebase (see PROJECT.md), so this doesn't invent one
  // either — clicking the line-name row again, or picking a field, closes it.
  private renderFieldDropdown(): void {
    this.fieldDropdown.removeAll(true);
    if (!this.fieldDropdownOpen) return;

    const state = this.game.state;
    const unlockedFields = state.fields.filter((f) => f.unlocked).sort((a, b) => a.id - b.id);
    const rowH = 36;
    const y0 = FC_Y + this.fieldCardHeight + 6;
    const totalH = unlockedFields.length * rowH + 8;

    const bg = orchardFrame(this.scene, FC_X, y0, FC_DROPDOWN_W, totalH, { fill: ORCHARD.cream, fillAlpha: 0.99, radius: 10, outerAlpha: 0.8, inner: false });
    this.fieldDropdown.add(bg);

    unlockedFields.forEach((f, i) => {
      const ry = y0 + 4 + i * rowH;
      const variety = f.varietyId ? this.game.getVariety(f.varietyId) : undefined;
      const label = variety ? variety.customName : `FIELD ${f.id}`;
      const isSelected = f.id === this.selectedFieldId;
      if (isSelected) {
        const hi = this.scene.add.graphics();
        hi.fillStyle(ORCHARD.forestMid, 0.16);
        hi.fillRoundedRect(FC_X + 4, ry, FC_DROPDOWN_W - 8, rowH - 2, 6);
        this.fieldDropdown.add(hi);
      }
      this.fieldDropdown.add(mkText(this.scene, FC_X + 16, ry + 8, `FIELD ${f.id} — ${label}`, 15, ORCHARD.textDark, isSelected));
      if (f.slots.some((s) => s.ripe)) {
        this.fieldDropdown.add(this.scene.add.circle(FC_X + FC_DROPDOWN_W - 18, ry + rowH / 2 - 1, 6, 0xe0392b));
      }
      const zone = this.scene.add.zone(FC_X, ry, FC_DROPDOWN_W, rowH).setOrigin(0, 0);
      zone.setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.selectedFieldId = f.id;
        this.fieldDropdownOpen = false;
        this.render();
      });
      this.fieldDropdown.add(zone);
    });
  }

  private priceForField(id: number): number {
    return TUNING.FIELD_PRICES[id] ?? 0;
  }

  private tryBuyField(id: number): void {
    const state = this.game.state;
    if (id === 2 && state.day < TUNING.FIELD2_UNLOCK_DAY) {
      this.toasts.show(`Field 2 unlocks on Day ${TUNING.FIELD2_UNLOCK_DAY}`, THEME.danger);
      return;
    }
    const price = this.priceForField(id);
    if (state.cash < price) {
      this.toasts.show(`Need $${price} to buy this field`, THEME.danger);
      return;
    }
    if (this.game.buyField(id)) {
      this.toasts.show('New field purchased! You now own more orchard.', THEME.accent);
      this.selectedFieldId = id;
      this.render();
    }
  }

  private renderMain(): void {
    const field = this.game.getField(this.selectedFieldId);
    if (!field || !field.varietyId) {
      this.mainView.removeAll(true);
      this.mainViewFieldId = null;
      this.mainViewVarietyId = null;
      return;
    }
    const variety = this.game.getVariety(field.varietyId);
    if (!variety) return;

    // Only tear down and rebuild when the selected field or its planted
    // variety actually changed — a plain re-render (including MainScene's
    // periodic auto-refresh, which fires every ~120ms regardless of screen)
    // just refreshes the handful of values that can change without either
    // of those (cultivation policy, ripe-fruit count, packing occupancy) in
    // place instead.
    if (field.id !== this.mainViewFieldId || variety.id !== this.mainViewVarietyId) {
      this.mainView.removeAll(true);
      this.mainViewFieldId = field.id;
      this.mainViewVarietyId = variety.id;
      this.changeVarietyBtn = null;
      this.cultivationBtns = [];
      this.harvestBtn = null;
      this.statValueTexts = [];
      this.packingText = null;
      this.buildStatsCard(field, variety);
      this.buildActionCard(field);
    } else {
      this.updateStatsCard(field, variety);
      this.updateActionCard(field);
    }
  }

  // ------------------------------------------------------------------
  // Lower-left Stats card — the five real genetic traits of the currently
  // selected Field/Line (see PROJECT.md "Genetic Traits" — Sweetness/Size
  // are cultivation-adjusted via effectiveStats, Yield/Growth/Freshness are
  // not). Icons + labels are static (built once per field/variety switch);
  // only the numbers refresh on cultivation-policy changes.
  // ------------------------------------------------------------------
  private buildStatsCard(field: Field, variety: Variety): void {
    const y = LOWER_CARD_BOTTOM - SC_H;
    // Old Graphics cream fill/border — kept only as a hidden fallback (see
    // PROJECT.md "ART BOUNDARY" pattern already used for tree/canopy
    // placeholders) in case the frame asset ever fails to load; never drawn
    // on top of the new asset.
    const bg = orchardFrame(this.scene, SC_X, y, SC_W, SC_H, { fill: ORCHARD.cream, fillAlpha: 0.97, radius: 14, outerAlpha: 0.75, innerColor: ORCHARD.forestMid, innerAlpha: 0.16 });
    bg.setVisible(false);
    this.mainView.add(bg);

    // New premium cream/parchment + gold NineSlice frame — corners render
    // unstretched at their native asset resolution; only the flat edge/
    // center regions stretch to fill the card's existing SC_X/SC_W/SC_H
    // footprint (position/size unchanged from the old Graphics card).
    const frame = this.scene.add.nineslice(
      SC_X + SC_W / 2,
      y + SC_H / 2,
      ORCHARD_STATS_FRAME_KEY,
      undefined,
      SC_W,
      SC_H,
      SC_FRAME_BORDER.left,
      SC_FRAME_BORDER.right,
      SC_FRAME_BORDER.top,
      SC_FRAME_BORDER.bottom,
    );
    this.mainView.add(frame);

    const colW = SC_W / STAT_ORDER.length;
    const sepG = this.scene.add.graphics();
    sepG.lineStyle(1, ORCHARD.gold, 0.35);
    for (let i = 1; i < STAT_ORDER.length; i++) {
      const sx = SC_X + colW * i;
      sepG.lineBetween(sx, y + 18, sx, y + SC_H - 14);
    }
    this.mainView.add(sepG);

    this.statValueTexts = STAT_ORDER.map((s, i) => {
      const cx = SC_X + colW * i + colW / 2;
      const iconG = this.scene.add.graphics();
      drawStatIcon(iconG, s.key, cx, y + 28);
      this.mainView.add(iconG);
      this.mainView.add(mkText(this.scene, cx, y + 50, s.label, 11, '#8a6d1a', true, true).setOrigin(0.5));
      const valText = mkText(this.scene, cx, y + 72, '0', 24, ORCHARD.textDark, true, true).setOrigin(0.5);
      this.mainView.add(valText);
      return valText;
    });

    // Reuses the existing shared stat-help modal (see StatHelpModal.ts,
    // already used identically on both Breed screens) rather than a second,
    // duplicate stat-description system — a small subtle "i" affordance in
    // the card's own top-right corner.
    this.mainView.add(createStatInfoButton(this.scene, SC_X + SC_W - 18, y + 18, 12));

    this.updateStatsCard(field, variety);
  }

  private updateStatsCard(field: Field, variety: Variety): void {
    if (this.statValueTexts.length === 0) return;
    const eff = effectiveStats(variety, field.policy);
    const values = [Math.round(eff.sweetness), Math.round(eff.size), Math.round(variety.yieldStat), Math.round(variety.growth), Math.round(variety.freshness)];
    this.statValueTexts.forEach((t, i) => t.setText(String(values[i])));
  }

  // ------------------------------------------------------------------
  // Lower-right Orchard action card — Cultivation (segmented control),
  // Change Variety, Packing count/capacity, and HARVEST ALL (see
  // PROJECT.md "LOWER-RIGHT ORCHARD ACTION CARD"). Only at-a-glance Packing
  // info is shown here; seconds/apple and upgrade cost stay behind the
  // existing Shipping Infrastructure modal.
  // ------------------------------------------------------------------
  private buildActionCard(field: Field): void {
    const y = LOWER_CARD_BOTTOM - AC_H;
    const bg = orchardFrame(this.scene, AC_X, y, AC_W, AC_H, { fill: ORCHARD.cream, fillAlpha: 0.97, radius: 14, outerAlpha: 0.75, innerColor: ORCHARD.forestMid, innerAlpha: 0.16 });
    this.mainView.add(bg);

    // Compact three-row hierarchy (see PROJECT.md "LOWER-RIGHT ORCHARD
    // ACTION CARD"): TOP ROW = Change Variety (secondary) + Packing
    // (informational, click preserved); MIDDLE ROW = Cultivation segmented
    // control; BOTTOM ROW = HARVEST ALL at nearly full card width.
    const padTop = 10;
    const rowGap = 8;
    const topRowH = 30;
    const midRowH = 36;
    const bottomRowH = AC_H - padTop - topRowH - rowGap - midRowH - rowGap - 6;

    // TOP ROW — CHANGE VARIETY: a smaller, lighter secondary action (muted
    // cream, same tone as an unselected Cultivation segment) so it never
    // competes with HARVEST ALL below.
    const topRowY = y + padTop;
    const cvW = 168;
    this.changeVarietyBtn = new Button(
      this.scene,
      AC_X + AC_PAD + cvW / 2,
      topRowY + topRowH / 2,
      cvW,
      topRowH,
      'CHANGE VARIETY',
      () => this.openVarietyPicker(field.id),
      SECONDARY_BG,
      13,
      false,
      ORCHARD.textDark,
    );
    this.mainView.add(this.changeVarietyBtn);

    // TOP ROW — PACKING: mostly informational; existing click → Shipping
    // Infrastructure behavior preserved. Right-aligned against the card's
    // own right edge, filling the remaining top-row width.
    this.packingText = mkText(this.scene, AC_X + AC_W - AC_PAD, topRowY + topRowH / 2, '', 16, ORCHARD.textDark, true, true).setOrigin(1, 0.5);
    this.mainView.add(this.packingText);
    const packingZoneX = AC_X + AC_PAD + cvW + 8;
    const packingZoneW = AC_X + AC_W - AC_PAD - packingZoneX;
    const packingZone = this.scene.add.zone(packingZoneX, topRowY, packingZoneW, topRowH).setOrigin(0, 0);
    packingZone.setInteractive({ useHandCursor: true });
    packingZone.on('pointerdown', () => openShippingInfraModal(this.scene, this.game));
    this.mainView.add(packingZone);

    // MIDDLE ROW — Cultivation label + segmented control, restyled onto the
    // Orchard palette: SELECTED = deep forest fill + warm cream text + a
    // thin gold accent border; UNSELECTED = muted-cream "secondary" fill +
    // dark olive text.
    const midRowY = topRowY + topRowH + rowGap;
    const cultLabel = mkText(this.scene, AC_X + AC_PAD, midRowY + midRowH / 2, 'CULTIVATION', 11, '#8a6d1a', true, true).setOrigin(0, 0.5);
    this.mainView.add(cultLabel);
    const segStartX = AC_X + AC_PAD + cultLabel.width + 10;
    const segEndX = AC_X + AC_W - AC_PAD;
    const segGap = 6;
    const segW = (segEndX - segStartX - segGap * 2) / 3;
    const policies: { id: CultivationPolicy; label: string }[] = [
      { id: 'NORMAL', label: 'NORMAL' },
      { id: 'SWEETEN', label: 'SWEETEN' },
      { id: 'GROW_BIG', label: 'GROW BIG' },
    ];
    this.cultivationBtns = policies.map((p, i) => {
      const active = (field.pendingPolicy ?? field.policy) === p.id;
      const btn = new Button(
        this.scene,
        segStartX + segW / 2 + i * (segW + segGap),
        midRowY + midRowH / 2,
        segW,
        midRowH,
        p.label,
        () => {
          this.game.setFieldPolicy(field.id, p.id);
          this.render();
        },
        active ? ORCHARD.forestDeep : SECONDARY_BG,
        13,
        false,
        active ? ORCHARD.textWarmLight : ORCHARD.textDark,
      );
      btn.setAccent(active);
      this.mainView.add(btn);
      return { btn, policy: p.id };
    });

    // BOTTOM ROW — HARVEST ALL: the strongest action inside this card, deep
    // forest fill (not gold, which stays reserved for END DAY/restrained
    // accents) with a thin gold accent border, spanning nearly the full
    // card width.
    const bottomRowY = midRowY + midRowH + rowGap;
    const anyRipe = field.slots.some((s) => s.ripe);
    this.harvestBtn = new Button(
      this.scene,
      AC_X + AC_W / 2,
      bottomRowY + bottomRowH / 2,
      AC_W - AC_PAD * 2,
      bottomRowH,
      'HARVEST ALL',
      () => this.treeLayer.harvestAllRemaining(),
      anyRipe ? ORCHARD.forestDeep : 0x9c9484,
      18,
    );
    this.harvestBtn.setAccent(true);
    this.harvestBtn.setEnabled(anyRipe);
    this.mainView.add(this.harvestBtn);

    this.updateActionCard(field);
  }

  // Refreshes only the values that can change without a field/variety
  // switch (cultivation policy, ripe-fruit count, packing occupancy) on the
  // already-built, still-alive Button/Text instances — no destroy/recreate,
  // so a pointer resting on one of these controls keeps its hover state
  // stable instead of re-triggering pointerover on a freshly-created
  // GameObject every tick.
  private updateActionCard(field: Field): void {
    const effectivePolicy = field.pendingPolicy ?? field.policy;
    this.cultivationBtns.forEach(({ btn, policy }) => {
      const active = policy === effectivePolicy;
      btn.setColor(active ? ORCHARD.forestDeep : SECONDARY_BG);
      btn.setTextColor(active ? ORCHARD.textWarmLight : ORCHARD.textDark);
      btn.setAccent(active);
    });

    const anyRipe = field.slots.some((s) => s.ripe);
    this.harvestBtn?.setColor(anyRipe ? ORCHARD.forestDeep : 0x9c9484);
    this.harvestBtn?.setEnabled(anyRipe);

    const capacity = this.game.packingCapacity();
    this.packingText?.setText(`PACKING ${this.game.state.processingQueue.length}/${capacity} ▸`);
  }

  private openVarietyPicker(fieldId: number): void {
    openVarietyPickerModal(this.scene, this.game, 'Choose Variety to Plant', (v) => {
      this.game.plantVariety(fieldId, v.id);
      this.render();
    });
  }
}
