import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { ContestType } from '../tuning.ts';
import { APPLE_ASSET_IDS, APPLE_CATALOG_NUMBER, type AppleAssetId } from '../render/appleAssets.ts';
import { getDayDef, nextEvent, type DayDef } from '../systems/calendar.ts';
import { gameClockLabel } from '../systems/clock.ts';
import { formatMarketPct } from '../systems/market.ts';
import { openMarketOverview } from './MarketScreen.ts';
import { openContestInfoModal } from './ContestInfoModal.ts';
import { LAYOUT, ORCHARD } from './theme.ts';
import { formatMoney, orchardFrame, text as mkText } from './uiKit.ts';

// END DAY button art (see MainScene.preload() — loaded the same way as
// every other Orchard UI asset). The plaque has "END DAY →" baked into the
// image itself, so no separate Text is drawn over it (see EndDayButton).
export const ORCHARD_END_DAY_BUTTON_KEY = 'orchard-end-day-button';
export const ORCHARD_END_DAY_BUTTON_PATH = 'assets/ui/orchard_end_day_button.png';

// Shared background art for the 4 top-HUD info panels (DAY/TIME, CASH,
// MARKET, NEXT CONTEST) — see MainScene.preload(), loaded/filtered the same
// way as every other Orchard UI asset. Same 2172x724 source resolution as
// ORCHARD_END_DAY_BUTTON_KEY (same asset pack) — see INFO_PANEL_SRC_W/H
// below, which is what lets every card be scaled by the exact same rule
// EndDayButton already uses (uniform scale-to-height, never a non-uniform
// stretch) so all 5 top-HUD elements read as one consistent series.
export const ORCHARD_HUD_INFO_PANEL_KEY = 'orchard-hud-info-panel';
export const ORCHARD_HUD_INFO_PANEL_PATH = 'assets/ui/orchard_hud_info_panel.png';

// Top-HUD info-card icons (see MainScene.preload()) — one per card, plus 3
// MARKET variants swapped at runtime by refresh() (see setMarketIcon below).
export const ORCHARD_HUD_ICON_CALENDAR_KEY = 'orchard-hud-icon-calendar';
export const ORCHARD_HUD_ICON_CALENDAR_PATH = 'assets/ui/hud/orchard_hud_icon_calendar.png';
export const ORCHARD_HUD_ICON_CASH_KEY = 'orchard-hud-icon-cash';
export const ORCHARD_HUD_ICON_CASH_PATH = 'assets/ui/hud/orchard_hud_icon_cash.png';
export const ORCHARD_HUD_ICON_MARKET_UP_KEY = 'orchard-hud-icon-market-up';
export const ORCHARD_HUD_ICON_MARKET_UP_PATH = 'assets/ui/hud/orchard_hud_icon_market_up.png';
export const ORCHARD_HUD_ICON_MARKET_DOWN_KEY = 'orchard-hud-icon-market-down';
export const ORCHARD_HUD_ICON_MARKET_DOWN_PATH = 'assets/ui/hud/orchard_hud_icon_market_down.png';
export const ORCHARD_HUD_ICON_MARKET_FLAT_KEY = 'orchard-hud-icon-market-flat';
export const ORCHARD_HUD_ICON_MARKET_FLAT_PATH = 'assets/ui/hud/orchard_hud_icon_market_flat.png';
export const ORCHARD_HUD_ICON_CONTEST_KEY = 'orchard-hud-icon-contest';
export const ORCHARD_HUD_ICON_CONTEST_PATH = 'assets/ui/hud/orchard_hud_icon_contest.png';

const CARD_Y = 14;
const CARD_RADIUS = 12;

// END DAY (unchanged — see task "Do NOT touch: END DAY"). Kept exactly as
// before: a single image, uniformly scaled (never setDisplaySize'd
// non-uniformly) to a target height, so its native 3:1 aspect ratio is
// preserved and its own rendered width simply follows from that.
const END_DAY_BASE_H = 56;
const END_DAY_BUTTON_SCALE = 1.85;
const END_DAY_BUTTON_H = END_DAY_BASE_H * END_DAY_BUTTON_SCALE;
const END_DAY_BUTTON_Y_NUDGE = 8;
const END_DAY_CARD_W = 208;
const END_DAY_CARD_X = LAYOUT.width - 16 - END_DAY_CARD_W;

// Orchard top-HUD info row. The 4 info cards share the same 2172x724 source
// shape as END DAY (see INFO_PANEL_SRC_W/H), but the two PNGs were exported
// with *different* transparent margins around their visible gold frame — verified
// by scanning each source's alpha channel: END DAY's visible frame spans
// y=[72,596] of its own 724px canvas, the info-panel art's spans y=[102,558].
// So matching "visible top/bottom edge" between the two (this pass's ask)
// isn't a uniform scale-to-same-height like before — it needs a *different*
// scale on Y than on X. X keeps the old (unchanged-width) factor; Y is
// solved below so the panel's own visible edges land exactly on END DAY's.
const INFO_PANEL_SRC_W = 2172;
const INFO_PANEL_SRC_H = 724;
const END_DAY_VISIBLE_TOP_SRC = 72;
const END_DAY_VISIBLE_BOTTOM_SRC = 596;
const INFO_PANEL_VISIBLE_TOP_SRC = 102;
const INFO_PANEL_VISIBLE_BOTTOM_SRC = 558;

// END DAY's actual on-screen visible top/bottom, derived from its own
// existing (untouched) position/scale — see EndDayButton below. This is
// what the info row's *visible* frame gets solved against.
const END_DAY_SCALE = END_DAY_BUTTON_H / INFO_PANEL_SRC_H;
const END_DAY_CANVAS_TOP = CARD_Y - END_DAY_BUTTON_Y_NUDGE;
const END_DAY_VISIBLE_TOP = END_DAY_CANVAS_TOP + END_DAY_VISIBLE_TOP_SRC * END_DAY_SCALE;
const END_DAY_VISIBLE_BOTTOM = END_DAY_CANVAS_TOP + END_DAY_VISIBLE_BOTTOM_SRC * END_DAY_SCALE;

// X unchanged from the previous pass (cards stay the same width). Y is a
// deliberately different (larger) scale — see the block comment above —
// which is what grows the cards' visible height without touching width.
const INFO_CARD_SCALE_X = END_DAY_SCALE;
const INFO_CARD_SCALE_Y = (END_DAY_VISIBLE_BOTTOM - END_DAY_VISIBLE_TOP) / (INFO_PANEL_VISIBLE_BOTTOM_SRC - INFO_PANEL_VISIBLE_TOP_SRC);
const INFO_CARD_W = INFO_PANEL_SRC_W * INFO_CARD_SCALE_X;
// Full (padded) texture height at the new Y scale — used only for the
// hidden fallback/hit-zones below, never for visual alignment (that's
// INFO_VISIBLE_TOP/BOTTOM, which is what actually matches END DAY).
const INFO_CARD_H = INFO_PANEL_SRC_H * INFO_CARD_SCALE_Y;
// Full-texture top, positioned so the panel's own visible top edge
// (INFO_PANEL_VISIBLE_TOP_SRC scaled by Y) lands exactly on END_DAY_VISIBLE_TOP.
const INFO_ROW_Y = END_DAY_VISIBLE_TOP - INFO_PANEL_VISIBLE_TOP_SRC * INFO_CARD_SCALE_Y;
// By construction these equal END_DAY_VISIBLE_TOP/BOTTOM — kept as their
// own names for readability at each layout call site below.
const INFO_VISIBLE_TOP = INFO_ROW_Y + INFO_PANEL_VISIBLE_TOP_SRC * INFO_CARD_SCALE_Y;
const INFO_VISIBLE_BOTTOM = INFO_ROW_Y + INFO_PANEL_VISIBLE_BOTTOM_SRC * INFO_CARD_SCALE_Y;
// Small, uniform rhythm — between each of the 4 cards, and again between
// the 4th card and END DAY (the extra gap there doubles as a visual break
// between "info" and "the primary action"). Unchanged this pass.
const INFO_CARD_GAP = 5;
const INFO_ROW_X = 10;

const DAY_CARD_X = INFO_ROW_X;
const CASH_CARD_X = DAY_CARD_X + INFO_CARD_W + INFO_CARD_GAP;
const MARKET_CARD_X = CASH_CARD_X + INFO_CARD_W + INFO_CARD_GAP;
const CONTEST_CARD_X = MARKET_CARD_X + INFO_CARD_W + INFO_CARD_GAP;

// Compact "+$" shipment feedback, directly under the CASH card's new
// (taller) footprint.
const SHIPMENT_FEEDBACK_X = CASH_CARD_X + INFO_CARD_W / 2;
const SHIPMENT_FEEDBACK_Y = INFO_ROW_Y + INFO_CARD_H + 6;
const SHIPMENT_FEEDBACK_RISE_PX = 14;
const SHIPMENT_FEEDBACK_DURATION_MS = 700;

// In-card layout: [icon]  HEADING  VALUE — all on one line. CARD_PAD_X is
// the shared left/right padding (icon starts at it, value ends at it) —
// the frame's own rounded corner + gem/leaf ornament fully resolve by
// x=220 of the 2172px-wide source on both sides (verified by scanning the
// source alpha channel), which at INFO_CARD_SCALE_X is well inside this
// padding, so content never touches the frame's decorative border.
const INFO_ICON_SIZE = 62;
const CARD_PAD_X = 24;
const ICON_TEXT_GAP = 14;
const INFO_TEXT_X = CARD_PAD_X + INFO_ICON_SIZE + ICON_TEXT_GAP;
const INFO_TEXT_WIDTH = INFO_CARD_W - CARD_PAD_X - INFO_TEXT_X;
// Gap between the heading and the value that follows it on the same line —
// only MARKET still has a heading (see below).
const HEADING_VALUE_GAP = 10;
// Icon + heading + value are all vertically centered as one group on the
// frame's actual visible interior (INFO_VISIBLE_TOP..INFO_VISIBLE_BOTTOM),
// not the padded texture bounds, so the group stays centered in the gold
// frame itself regardless of how much transparent margin the source PNG
// carries above/below it.
const INFO_ICON_CENTER_Y = (INFO_VISIBLE_TOP + INFO_VISIBLE_BOTTOM) / 2;
// CASH has no heading — its value text is the sole content of the card,
// sized up accordingly (target ~28-30px) and only shrunk below that (every
// refresh — this one stays dynamic per-refresh, see task) if an unusually
// long value can't fit next to the icon.
const INFO_VALUE_LARGE_MAX_SIZE = 30;
const INFO_VALUE_LARGE_MIN_SIZE = 18;
// MARKET keeps its small "MARKET" heading, but the value next to it
// (catalog # + pct + caret) is sized up to be the dominant text.
const INFO_MARKET_VALUE_MAX_SIZE = 29;
const INFO_MARKET_VALUE_MIN_SIZE = 16;
// DAY and CONTEST must render at ONE FIXED size that never changes as
// their text changes (see task: no auto-fit on clock tick / contest name
// change) — resolveFixedFontSize (below) solves this once, at construction,
// against the longest "normal" string each card will ever show, then that
// size is frozen forever; refresh() only ever calls setText on them, never
// setFontSize/fitTextNoWrap.
const DAY_TEXT_FIT_MAX_SIZE = 30;
const DAY_TEXT_FIT_MIN_SIZE = 14;
// Worst-case "normal" DAY value: 2-digit day + the latest possible clock
// time — covers every digit-width combination the live HH:MM can ever take,
// so no live value can end up wider than what this was solved against.
const DAY_TEXT_WORST_CASE = 'DAY 99 / 23:59';
// HUD-only display shrink for the Contest headline — "{day}{ordinal} {SHORT}"
// (a real English ordinal — see ordinalSuffix below), no "DAY"/"APPLE"/
// separators (see contestHudShortLabel below and task: this is a
// display-only abbreviation, Contest's own internal type/label data in
// systems/contest.ts is untouched). Rendered in ORCHARD.fontBody (Libre
// Baskerville) — same family as DAY/CASH — not fontDisplay (Cormorant
// Garamond): the latter clipped its own caps/ascenders against Phaser's
// text-canvas metrics at this size, a font-specific rendering issue no
// amount of padding/position fixed.
const CONTEST_TEXT_FIT_MAX_SIZE = 36;
const CONTEST_TEXT_FIT_MIN_SIZE = 16;
// Worst-case "normal" CONTEST value: 2-digit day + a 2-letter ordinal
// suffix (st/nd/rd/th are all 2 chars, so any suffix choice is the same
// width) + the longest HUD short label ("SWEETEST"/"FRESHEST", both 8
// chars — see CONTEST_HUD_SHORT_LABELS below; "GRAND"/"BIGGEST" are shorter).
const CONTEST_TEXT_WORST_CASE = '99th FRESHEST';
// Small rightward nudge applied only to CASH's icon+value group (not the
// card itself) so the pair reads as centered inside the card — see task
// "CASH content is slightly too far left".
const CASH_CONTENT_X_NUDGE = 10;
// MARKET auto-rotation (see task: "weather report" style cycling through
// every discovered Visual Variety's entry, one at a time — real Market
// data, no new dummy entries). Each entry holds for roughly
// (MARKET_ROTATE_INTERVAL_MS - MARKET_ROTATE_ANIM_MS) ≈ 4.5s before the next
// flip begins (bumped +2s from the original ~2.5s hold per a later request).
const MARKET_ROTATE_INTERVAL_MS = 4800;
const MARKET_ROTATE_ANIM_MS = 300;

/** Draws one deep-forest card shell with a thin gold outer stroke plus a subtle inset inner line (see uiKit.ts orchardFrame) — kept only as a hidden fallback in case ORCHARD_HUD_INFO_PANEL_KEY ever fails to load (see the same pattern OrchardScreen's Stats/Action cards already use for their own NineSlice frame assets); never drawn on top of the new asset. */
function drawCard(scene: Phaser.Scene, x: number): Phaser.GameObjects.Graphics {
  return orchardFrame(scene, x, INFO_ROW_Y, INFO_CARD_W, INFO_CARD_H, { radius: CARD_RADIUS, outerAlpha: 0.55, innerAlpha: 0.18 }).setVisible(false);
}

/** The shared ornate background for the 4 top-HUD info panels — same asset EndDayButton uses. Scaled non-uniformly on purpose this pass (INFO_CARD_SCALE_X != INFO_CARD_SCALE_Y) to correct for the two PNGs' different internal transparent margins so the *visible* gold frames align — see the block comment above INFO_PANEL_SRC_W. */
function drawInfoPanel(scene: Phaser.Scene, x: number): Phaser.GameObjects.Image {
  return scene.add.image(x, INFO_ROW_Y, ORCHARD_HUD_INFO_PANEL_KEY).setOrigin(0, 0).setScale(INFO_CARD_SCALE_X, INFO_CARD_SCALE_Y);
}

/** Left-column icon for one info card, vertically centered on the frame's opaque interior (see INFO_ICON_CENTER_Y above) — same width/height, so its square aspect ratio is never distorted. */
function drawInfoIcon(scene: Phaser.Scene, cardX: number, key: string): Phaser.GameObjects.Image {
  return scene.add.image(cardX + CARD_PAD_X + INFO_ICON_SIZE / 2, INFO_ICON_CENTER_Y, key).setDisplaySize(INFO_ICON_SIZE, INFO_ICON_SIZE);
}

/**
 * Shrinks `t`'s font size (maxSize down to minSize) to fit within maxWidth
 * on one line. If it's still too wide even at minSize, wraps as a last
 * resort instead of overflowing the card (still reads fine: origin (0, 0.5)
 * re-centers the whole wrapped block on the same row the icon sits on).
 * Used by MARKET's value, next to its "MARKET" heading — see fitTextNoWrap
 * below for the 3 cards that must never wrap.
 */
function fitValueText(t: Phaser.GameObjects.Text, maxWidth: number, maxSize: number, minSize: number): void {
  t.setWordWrapWidth(null); // disable wrap so t.width below reflects true single-line width
  let size = maxSize;
  t.setFontSize(size);
  while (t.width > maxWidth && size > minSize) {
    size -= 1;
    t.setFontSize(size);
  }
  if (t.width > maxWidth) {
    t.setWordWrapWidth(maxWidth, true);
  }
}

/**
 * Same shrink-to-fit as fitValueText, but NEVER wraps — used by cards that
 * must always render as one line (DAY, CASH, CONTEST per this pass's spec).
 * Shrinks down to minSize and stops there even if still slightly too wide,
 * rather than falling back to a 2-line wrap.
 */
function fitTextNoWrap(t: Phaser.GameObjects.Text, maxWidth: number, maxSize: number, minSize: number): void {
  t.setWordWrapWidth(null);
  let size = maxSize;
  t.setFontSize(size);
  while (t.width > maxWidth && size > minSize) {
    size -= 1;
    t.setFontSize(size);
  }
}

/**
 * Solves ONE fixed font size for `t`, once, by temporarily rendering
 * `worstCase` (the longest string this card will ever normally show) and
 * shrink-to-fitting it exactly like fitTextNoWrap — then restores `t`'s
 * real text but leaves the resolved size in place. Callers must never call
 * setFontSize/fitTextNoWrap/fitValueText on `t` again afterward — refresh()
 * should only ever setText() it, so the live value's own width (which
 * varies character-to-character even at a constant string length, e.g. "1"
 * vs "8") can never nudge the rendered size up or down.
 */
function resolveFixedFontSize(t: Phaser.GameObjects.Text, worstCase: string, maxWidth: number, maxSize: number, minSize: number): void {
  const original = t.text;
  t.setText(worstCase);
  fitTextNoWrap(t, maxWidth, maxSize, minSize);
  t.setText(original);
}

/** Sets `value`'s X to sit right after `heading` on the same line (both already vertically centered at INFO_ICON_CENTER_Y) and returns the width remaining before the card's right padding — the caller passes that into fitValueText. Used only by MARKET now — the other 3 cards have no heading, so their value text starts directly at INFO_TEXT_X instead. */
function placeValueAfterHeading(heading: Phaser.GameObjects.Text, value: Phaser.GameObjects.Text, textX: number, gap = HEADING_VALUE_GAP): number {
  const valueX = textX + heading.width + gap;
  value.setX(valueX);
  return textX + INFO_TEXT_WIDTH - valueX;
}

// HUD-only short labels for the Contest headline (see task section 2) —
// "APPLE" dropped, "CHAMPION" shortened, never touching
// systems/contest.ts's own CONTEST_LABELS (those stay the full names used
// everywhere else: Calendar, entry/results screens, etc).
const CONTEST_HUD_SHORT_LABELS: Record<ContestType, string> = {
  BIGGEST: 'BIGGEST',
  SWEETEST: 'SWEETEST',
  FRESHEST: 'FRESHEST',
  GRAND_CHAMPION: 'GRAND',
};

/** Real English ordinal suffix — 1st/2nd/3rd/4th...11th/12th/13th (the -teens exception)/21st/22nd/23rd/24th... */
function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** "{day}{ordinal} {SHORT}" — e.g. "14th SWEETEST", "7th BIGGEST", "21st GRAND". Falls back to the full title in the (never-expected) case a CONTEST-event day has no contestType. */
function contestHudShortLabel(day: DayDef): string {
  const short = day.contestType ? CONTEST_HUD_SHORT_LABELS[day.contestType] : day.title;
  return `${day.day}${ordinalSuffix(day.day)} ${short}`;
}

// Orchard typography pass: the one remaining HUD micro-heading (MARKET) is
// "small HUD information" — Libre Baskerville, per the font-role spec.
// Vertically centered (not top-aligned) so it lines up with the larger
// value text that follows it on the same line.
function microLabel(scene: Phaser.Scene, x: number, str: string): Phaser.GameObjects.Text {
  return mkText(scene, x, INFO_ICON_CENTER_Y, str, 12, ORCHARD.goldStr, true, false, ORCHARD.fontBody, true).setOrigin(0, 0.5);
}

/**
 * END DAY as a single image button (see PROJECT.md gold-usage rule — this
 * plaque replaces the old solid-gold Button, same top-right slot, same
 * click behavior). The art already contains the "END DAY →" label, so this
 * never draws its own Text — see ORCHARD_END_DAY_BUTTON_KEY above.
 *
 * setText() is kept as a no-op purely so HUD.refresh()'s existing call
 * (which used to switch the old Button's label between END DAY/CLOSING…/
 * END DAY ✓) doesn't need touching — state is now conveyed only via
 * setEnabled()'s dim/disable, matching "don't draw a separate Text".
 */
class EndDayButton {
  readonly image: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly baseScale: number;
  private enabled = true;

  constructor(scene: Phaser.Scene, rightX: number, centerY: number, targetH: number, onClick: () => void) {
    this.image = scene.add.image(rightX, centerY, ORCHARD_END_DAY_BUTTON_KEY).setOrigin(1, 0.5);
    this.baseScale = targetH / this.image.height;
    this.image.setScale(this.baseScale);

    // Additive white copy of the same texture, alpha 0 by default — only
    // brightens pixels the plaque art actually covers (its transparent
    // corners stay transparent) instead of a plain overlay rectangle.
    this.glow = scene.add.image(rightX, centerY, ORCHARD_END_DAY_BUTTON_KEY).setOrigin(1, 0.5);
    this.glow.setScale(this.baseScale);
    this.glow.setBlendMode(Phaser.BlendModes.ADD);
    this.glow.setAlpha(0);

    this.image.setInteractive({ useHandCursor: true });
    this.image.on('pointerover', () => {
      if (this.enabled) this.glow.setAlpha(0.35);
    });
    this.image.on('pointerout', () => {
      this.glow.setAlpha(0);
      this.image.setScale(this.baseScale);
    });
    this.image.on('pointerdown', () => {
      if (!this.enabled) return;
      this.image.setScale(this.baseScale * 0.97);
      onClick();
    });
    this.image.on('pointerup', () => this.image.setScale(this.baseScale));
  }

  addTo(container: Phaser.GameObjects.Container): void {
    container.add(this.image);
    container.add(this.glow);
  }

  setEnabled(e: boolean): void {
    this.enabled = e;
    if (e) {
      this.image.setInteractive({ useHandCursor: true });
    } else {
      this.image.disableInteractive();
      this.glow.setAlpha(0);
      this.image.setScale(this.baseScale);
    }
    this.image.setAlpha(e ? 1 : 0.55);
  }

  // No-op — see class doc comment above.
  setText(_t: string): void {}
}

export class HUD extends Phaser.GameObjects.Container {
  private game: Game;
  private dayText: Phaser.GameObjects.Text;
  private cashText: Phaser.GameObjects.Text;
  private marketText: Phaser.GameObjects.Text;
  private marketIcon: Phaser.GameObjects.Image;
  // Wraps marketIcon+marketText only (not the static "MARKET" heading) —
  // scaleY on this group is what plays the "weather report" flip between
  // entries (see playMarketFlip below) without disturbing marketIcon's own
  // scale, which setDisplaySize manages independently for its true pixel
  // size.
  private marketRotateGroup: Phaser.GameObjects.Container;
  // Stable catalog-order list of currently-discovered Visual Varieties (see
  // refresh() below) and which one is currently shown — real Market data
  // only, never fabricated entries.
  private marketIds: AppleAssetId[] = [];
  private marketIndex = 0;
  private eventText: Phaser.GameObjects.Text;
  private endDayBtn: EndDayButton;
  private onEndDay: () => void;
  // One persistent, reused Text for shipment feedback — never a growing
  // list of popups. A new shipment kills any in-flight tween and restarts
  // the animation from this same object/position.
  private shipmentText: Phaser.GameObjects.Text;
  // Whichever Contest the NEXT CONTEST / CONTEST TODAY headline currently
  // describes (see refresh() below) — kept so the click handler can open
  // the right ContestInfoModal without recomputing it from scratch.
  private hudContestDay: number | null = null;
  private hudContestType: ContestType | null = null;
  // Available width for each value text. DAY/CASH/CONTEST have no heading,
  // so their value simply gets the card's full INFO_TEXT_WIDTH. MARKET
  // still has a "MARKET" heading, so its value's available width is
  // computed once at construction from that heading's (never-changing)
  // width — see placeValueAfterHeading.
  private marketValueMaxWidth: number;

  constructor(scene: Phaser.Scene, game: Game, onEndDay: () => void) {
    super(scene, 0, 0);
    this.game = game;
    this.onEndDay = onEndDay;

    // DAY card — no heading; [icon]  DAY 13 / 12:19, one line, ONE FIXED
    // size solved once below (never re-shrunk per refresh — see task).
    this.add(drawCard(scene, DAY_CARD_X));
    this.add(drawInfoPanel(scene, DAY_CARD_X));
    this.add(drawInfoIcon(scene, DAY_CARD_X, ORCHARD_HUD_ICON_CALENDAR_KEY));
    this.dayText = mkText(scene, DAY_CARD_X + INFO_TEXT_X, INFO_ICON_CENTER_Y, '', DAY_TEXT_FIT_MAX_SIZE, ORCHARD.textWarmLight, true, false, ORCHARD.fontBody, true).setOrigin(0, 0.5);
    this.add(this.dayText);
    resolveFixedFontSize(this.dayText, DAY_TEXT_WORST_CASE, INFO_TEXT_WIDTH, DAY_TEXT_FIT_MAX_SIZE, DAY_TEXT_FIT_MIN_SIZE);

    // CASH card — no heading; [icon]  $199.20, one line, large. Icon+value
    // both nudged right by CASH_CONTENT_X_NUDGE so the pair reads centered
    // in the card (card geometry itself is untouched).
    this.add(drawCard(scene, CASH_CARD_X));
    this.add(drawInfoPanel(scene, CASH_CARD_X));
    this.add(drawInfoIcon(scene, CASH_CARD_X + CASH_CONTENT_X_NUDGE, ORCHARD_HUD_ICON_CASH_KEY));
    this.cashText = mkText(scene, CASH_CARD_X + INFO_TEXT_X + CASH_CONTENT_X_NUDGE, INFO_ICON_CENTER_Y, '', INFO_VALUE_LARGE_MAX_SIZE, ORCHARD.textWarmLight, true, false, ORCHARD.fontBody, true).setOrigin(0, 0.5);
    this.add(this.cashText);

    // MARKET card — clickable, opens the Market overview modal (unchanged
    // access path, just re-homed into its own card). Icon+value auto-rotate
    // through every discovered Visual Variety's real entry (see refresh()/
    // rotateMarket() below) — "MARKET" heading and the per-entry text format
    // itself stay exactly as before.
    this.add(drawCard(scene, MARKET_CARD_X));
    this.add(drawInfoPanel(scene, MARKET_CARD_X));
    // Group positioned at the card's vertical centerline so scaleY (the
    // flip animation) never shifts icon/text position — both children are
    // added at local y=0 below, not INFO_ICON_CENTER_Y directly.
    this.marketRotateGroup = scene.add.container(0, INFO_ICON_CENTER_Y);
    this.add(this.marketRotateGroup);
    this.marketIcon = drawInfoIcon(scene, MARKET_CARD_X, ORCHARD_HUD_ICON_MARKET_FLAT_KEY).setY(0);
    this.marketRotateGroup.add(this.marketIcon);
    const marketHeading = microLabel(scene, MARKET_CARD_X + INFO_TEXT_X, 'MARKET');
    this.add(marketHeading);
    this.marketText = mkText(scene, 0, 0, '', INFO_MARKET_VALUE_MAX_SIZE, ORCHARD.textWarmLight, false, false, ORCHARD.fontBody, true).setOrigin(0, 0.5);
    this.marketRotateGroup.add(this.marketText);
    this.marketValueMaxWidth = placeValueAfterHeading(marketHeading, this.marketText, MARKET_CARD_X + INFO_TEXT_X);
    const marketZone = scene.add.zone(MARKET_CARD_X, INFO_ROW_Y, INFO_CARD_W, INFO_CARD_H).setOrigin(0, 0);
    marketZone.setInteractive({ useHandCursor: true });
    marketZone.on('pointerdown', () => openMarketOverview(scene, game));
    this.add(marketZone);
    // Fires forever, independent of refresh()'s own cadence — see
    // rotateMarket() below for why the rotation index/list is otherwise
    // only ever touched from refresh() for syncing, never reset by it.
    scene.time.addEvent({ delay: MARKET_ROTATE_INTERVAL_MS, loop: true, callback: () => this.rotateMarket() });

    // CONTEST card — no heading; clickable, opens Contest info for whichever
    // Contest eventText currently describes (today's, if pending, otherwise
    // the upcoming one — see refresh() below).
    this.add(drawCard(scene, CONTEST_CARD_X));
    this.add(drawInfoPanel(scene, CONTEST_CARD_X));
    this.add(drawInfoIcon(scene, CONTEST_CARD_X, ORCHARD_HUD_ICON_CONTEST_KEY));
    // The contest headline itself is now the dominant text in this card —
    // ORCHARD.fontBody (Libre Baskerville), the same family DAY/CASH use
    // successfully at large fixed sizes (fontDisplay/Cormorant Garamond
    // clipped its own caps/ascenders here — a font-metrics issue, not a
    // layout one). Starts directly after the icon (no heading in the way),
    // at ONE FIXED size solved once below (never re-shrunk per refresh —
    // see task, same as DAY).
    this.eventText = mkText(scene, CONTEST_CARD_X + INFO_TEXT_X, INFO_ICON_CENTER_Y, '', CONTEST_TEXT_FIT_MAX_SIZE, ORCHARD.textWarmLight, true, false, ORCHARD.fontBody, true).setOrigin(0, 0.5);
    this.add(this.eventText);
    resolveFixedFontSize(this.eventText, CONTEST_TEXT_WORST_CASE, INFO_TEXT_WIDTH, CONTEST_TEXT_FIT_MAX_SIZE, CONTEST_TEXT_FIT_MIN_SIZE);
    const contestZone = scene.add.zone(CONTEST_CARD_X, INFO_ROW_Y, INFO_CARD_W, INFO_CARD_H).setOrigin(0, 0);
    contestZone.setInteractive({ useHandCursor: true });
    contestZone.on('pointerdown', () => {
      if (this.hudContestDay !== null && this.hudContestType !== null) {
        openContestInfoModal(scene, this.hudContestDay, this.hudContestType);
      }
    });
    this.add(contestZone);

    // Kept its semantic gain-green (not the palette's neutral textWarmLight)
    // — this is a "+$" feedback popup, not steady-state HUD chrome.
    this.shipmentText = mkText(scene, SHIPMENT_FEEDBACK_X, SHIPMENT_FEEDBACK_Y, '', 18, '#c9e69a', true, false, ORCHARD.fontBody, true).setOrigin(0.5, 0);
    this.shipmentText.setAlpha(0);
    this.add(this.shipmentText);

    // END DAY — the strongest, top-right action, unchanged behavior. Right
    // edge matches the old card's (END_DAY_CARD_X + END_DAY_CARD_W ==
    // LAYOUT.width - 16); top edge matches the old CARD_Y (minus a small
    // manual nudge upward) so the plaque grows downward from the same
    // top-right corner instead of drifting off the top of the 900px-tall
    // canvas.
    this.endDayBtn = new EndDayButton(
      scene,
      END_DAY_CARD_X + END_DAY_CARD_W,
      CARD_Y - END_DAY_BUTTON_Y_NUDGE + END_DAY_BUTTON_H / 2,
      END_DAY_BUTTON_H,
      this.onEndDay,
    );
    this.endDayBtn.addTo(this);

    scene.add.existing(this);

    // The Shipping/Processing Queue is ONE shared farm-wide line (not
    // per-Field) — every completed shipment shows feedback here regardless
    // of origin field or which bottom-nav screen is currently active, since
    // the HUD itself is always visible.
    game.on((event) => {
      if (event.type === 'shipment') this.showShipmentFeedback(event.revenue);
    });
  }

  // Compact "+$X.XX" under the cash card: fades in place, drifts lightly
  // upward, fades out — reusing the same Text/position every time rather
  // than stacking a list. Paired with a subtle scale pulse on the cash
  // total itself, since this is the moment cash actually increases.
  private showShipmentFeedback(revenue: number): void {
    this.scene.tweens.killTweensOf(this.shipmentText);
    this.shipmentText.setText(`+$${formatMoney(revenue)}`);
    this.shipmentText.setAlpha(1);
    this.shipmentText.setY(SHIPMENT_FEEDBACK_Y);
    this.scene.tweens.add({
      targets: this.shipmentText,
      y: SHIPMENT_FEEDBACK_Y - SHIPMENT_FEEDBACK_RISE_PX,
      alpha: 0,
      duration: SHIPMENT_FEEDBACK_DURATION_MS,
      ease: 'Sine.easeOut',
    });

    this.scene.tweens.killTweensOf(this.cashText);
    this.cashText.setScale(1);
    this.scene.tweens.add({
      targets: this.cashText,
      scale: 1.08,
      duration: 120,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  // Paints one Visual Variety's live entry into marketText/marketIcon —
  // reads current game state at call time (never caches a stale pct), so
  // whichever entry is on screen always reflects that day's real price. No
  // animation of its own; callers (refresh()'s first paint, or
  // playMarketFlip's mid-flip swap) decide when this becomes visible.
  private paintMarketEntry(visualId: AppleAssetId): void {
    const entry = this.game.state.visualMarket[visualId];
    const pct = entry?.pct ?? 0;
    const num = String(APPLE_CATALOG_NUMBER[visualId]).padStart(3, '0');
    this.marketText.setText(`#${num} ${formatMarketPct(pct)} ▸`);
    this.marketIcon.setTexture(
      Math.abs(pct) < 0.005 ? ORCHARD_HUD_ICON_MARKET_FLAT_KEY : pct > 0 ? ORCHARD_HUD_ICON_MARKET_UP_KEY : ORCHARD_HUD_ICON_MARKET_DOWN_KEY,
    );
    this.marketIcon.setDisplaySize(INFO_ICON_SIZE, INFO_ICON_SIZE);
    fitValueText(this.marketText, this.marketValueMaxWidth, INFO_MARKET_VALUE_MAX_SIZE, INFO_MARKET_VALUE_MIN_SIZE);
  }

  // "Weather report" flip: marketRotateGroup collapses to 0 height (a fake
  // rotate-away), swaps content at the midpoint, then expands back — never
  // touches marketIcon's own setDisplaySize scale (that's independent, on
  // the icon itself, not the group), so the two animations can't fight.
  private playMarketFlip(nextId: AppleAssetId): void {
    const group = this.marketRotateGroup;
    this.scene.tweens.killTweensOf(group);
    group.setScale(1, 1);
    this.scene.tweens.add({
      targets: group,
      scaleY: 0,
      duration: MARKET_ROTATE_ANIM_MS / 2,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.paintMarketEntry(nextId);
        this.scene.tweens.add({
          targets: group,
          scaleY: 1,
          duration: MARKET_ROTATE_ANIM_MS / 2,
          ease: 'Sine.easeOut',
        });
      },
    });
  }

  // Driven by the recurring timer in the constructor, entirely independent
  // of refresh()'s own cadence — refresh() only keeps marketIds in sync
  // with discovery and does the very first paint, so it can never interrupt
  // an in-flight flip or reset the rotation position.
  private rotateMarket(): void {
    if (this.marketIds.length <= 1) return; // nothing else to cycle to
    this.marketIndex = (this.marketIndex + 1) % this.marketIds.length;
    this.playMarketFlip(this.marketIds[this.marketIndex]);
  }

  refresh(): void {
    const s = this.game.state;
    // DAY card shows ONLY day/time, always — never a "CLOSING…"/"CLOSED"
    // status string (see task section 3: that overflowed the card). The
    // closing/dayEnded state itself is untouched game logic (still drives
    // END DAY's own label below, and gameClockLabel naturally reads
    // DAY_END_HOUR:00 once the day is over) — this just stops drawing text
    // for it in this card. Font size is fixed (resolveFixedFontSize, called
    // once in the constructor) — never touched here, so the clock ticking
    // never nudges it.
    this.dayText.setText(`DAY ${s.day} / ${gameClockLabel(s.dayTimeRemaining)}`);
    this.cashText.setText(`$${formatMoney(s.cash)}`);
    fitTextNoWrap(this.cashText, INFO_TEXT_WIDTH, INFO_VALUE_LARGE_MAX_SIZE, INFO_VALUE_LARGE_MIN_SIZE);

    // MARKET auto-rotation (see task section 1) — keep the discovered-id
    // list (stable catalog order, same convention as MarketScreen.ts) in
    // sync every refresh, but only touch the actual displayed content here
    // for the fallback (nothing discovered yet) or the very first paint;
    // every subsequent entry change is driven by rotateMarket() on its own
    // timer, never by this per-refresh sync, so it can't interrupt or reset
    // an in-flight flip.
    const hadMarketEntries = this.marketIds.length > 0;
    this.marketIds = APPLE_ASSET_IDS.filter((id) => s.discoveredVisualIds.includes(id));
    if (this.marketIds.length === 0) {
      this.marketText.setText('Steady ▸');
      this.marketIcon.setTexture(ORCHARD_HUD_ICON_MARKET_FLAT_KEY);
      this.marketIcon.setDisplaySize(INFO_ICON_SIZE, INFO_ICON_SIZE);
      fitValueText(this.marketText, this.marketValueMaxWidth, INFO_MARKET_VALUE_MAX_SIZE, INFO_MARKET_VALUE_MIN_SIZE);
    } else {
      if (this.marketIndex >= this.marketIds.length) this.marketIndex = 0;
      if (!hadMarketEntries) this.paintMarketEntry(this.marketIds[this.marketIndex]);
    }

    // Contest headline (see PROJECT.md "Contest" section 8) — Contest is
    // the only scheduled Calendar event left in V1, so `today` here is only
    // ever 'CONTEST' or 'NONE'. Once today's Contest has resolved, this
    // switches back to pointing at the next one, same day or not (see the
    // `todayPending` check below). HUD-only short label (see
    // contestHudShortLabel above) — font size is fixed (resolveFixedFontSize,
    // called once in the constructor), never touched here.
    const today = getDayDef(s.day);
    const todayPending = today.event === 'CONTEST' && !(s.contest?.day === s.day && s.contest.resolved);
    if (todayPending) {
      this.eventText.setText(contestHudShortLabel(today));
      this.hudContestDay = today.day;
      this.hudContestType = today.contestType ?? null;
    } else {
      const next = nextEvent(s.day);
      this.eventText.setText(contestHudShortLabel(next));
      this.hudContestDay = next.day;
      this.hudContestType = next.contestType ?? null;
    }

    this.endDayBtn.setEnabled(this.game.canEndDay());
    this.endDayBtn.setText(s.closing ? 'CLOSING…' : s.dayEnded ? 'END DAY ✓' : 'END DAY');
  }
}
