import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { CultivationPolicy, Field, Variety } from '../types.ts';
import { effectiveStats } from '../systems/economy.ts';
import { TUNING } from '../tuning.ts';
import { OrchardTreeLayer } from '../render/OrchardTreeLayer.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { LAYOUT, ORCHARD, THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { ToastQueue } from './modals.ts';
import { openVarietyPickerModal } from './varietyPicker.ts';
import { catalogLabel } from '../render/appleAssets.ts';
import { openShippingInfraModal } from './ShippingInfraModal.ts';

// ------------------------------------------------------------------
// Orchard UI redesign (see PROJECT.md "Orchard UI redesign") — final
// presentation STRUCTURE using current placeholder art. No side walls, no
// full-width bars: a compact top-left Field card, a lower-left Stats card,
// and a lower-right Cultivation/Change-Variety/Packing/Harvest-All action
// card, leaving the central Orchard/landscape open. All layout tuning below
// is presentation-only.
// ------------------------------------------------------------------

// Orchard Background V1 (see PROJECT.md "Orchard Background V1") — the
// single approved external painterly background, used exactly as supplied
// (no tinting/blurring/derivative processing). Exported so MainScene can
// load it under the same key/path this screen displays it with — the same
// pattern APPLE_ASSET_IDS/appleTextureKey/appleAssetPath already use for
// the apple illustrations.
export const ORCHARD_BACKGROUND_KEY = 'orchard-background';
export const ORCHARD_BACKGROUND_PATH = 'assets/orchard/orchard_background.png';

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
const SECONDARY_BG = 0xd9d3ac;

// Lower-left Stats card
const SC_X = 16;
const SC_W = 500;
const SC_H = 130;

// Lower-right Orchard action card (Cultivation / Change Variety / Packing / Harvest All)
const AC_W = 480;
const AC_H = 210;
const AC_X = LAYOUT.width - 16 - AC_W;
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
  private background: Phaser.GameObjects.Image;
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
    this.background = scene.add.image(0, -LAYOUT.contentTop, ORCHARD_BACKGROUND_KEY).setOrigin(0, 0);
    this.background.setDisplaySize(LAYOUT.width, LAYOUT.height);

    this.treeLayer = new OrchardTreeLayer(scene, game);
    this.fieldCard = scene.add.container(0, 0);
    this.mainView = scene.add.container(0, 0);
    this.fieldDropdown = scene.add.container(0, 0);
    // Draw order: background, then trees, then the field card, then the
    // stats/action card content, then the field dropdown popup topmost (so
    // it never renders underneath the card it opens from).
    this.add([this.background, this.treeLayer, this.fieldCard, this.mainView, this.fieldDropdown]);
    scene.add.existing(this);
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

  /** Called every real frame from MainScene.update() so fruit-reveal/sway animations progress smoothly. */
  updateTrees(dtSeconds: number): void {
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

    const pillG = this.scene.add.graphics();
    pillG.fillStyle(ORCHARD.forestDeep, 1);
    pillG.fillRoundedRect(FC_X, FC_ROW_Y, pillW, FC_ROW_H, FC_ROW_H / 2);
    pillG.lineStyle(1.5, ORCHARD.gold, 0.7);
    pillG.strokeRoundedRect(FC_X, FC_ROW_Y, pillW, FC_ROW_H, FC_ROW_H / 2);
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
    // cream/muted-gold styling, distinct from the pill's deep-forest fill.
    let rightEdge = FC_X + pillW;
    if (nextId) {
      const price = this.priceForField(nextId);
      const addLabel = mkText(this.scene, 0, 0, `+ FIELD $${price}`, 16, ORCHARD.textDark, true);
      const addW = FC_PILL_PAD_X + addLabel.width + FC_PILL_PAD_X;
      const addX = rightEdge + 10;
      const addG = this.scene.add.graphics();
      addG.fillStyle(THEME.gold, 1);
      addG.fillRoundedRect(addX, FC_ROW_Y, addW, FC_ROW_H, FC_ROW_H / 2);
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

    const bg = this.scene.add.graphics();
    bg.fillStyle(ORCHARD.cream, 0.99);
    bg.fillRoundedRect(FC_X, y0, FC_DROPDOWN_W, totalH, 10);
    bg.lineStyle(1.5, ORCHARD.gold, 0.8);
    bg.strokeRoundedRect(FC_X, y0, FC_DROPDOWN_W, totalH, 10);
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
    const y = LAYOUT.contentHeight - 16 - SC_H;
    const bg = this.scene.add.graphics();
    bg.fillStyle(ORCHARD.cream, 0.97);
    bg.fillRoundedRect(SC_X, y, SC_W, SC_H, 14);
    bg.lineStyle(1.5, ORCHARD.gold, 0.75);
    bg.strokeRoundedRect(SC_X, y, SC_W, SC_H, 14);
    this.mainView.add(bg);

    const colW = SC_W / STAT_ORDER.length;
    this.statValueTexts = STAT_ORDER.map((s, i) => {
      const cx = SC_X + colW * i + colW / 2;
      const iconG = this.scene.add.graphics();
      drawStatIcon(iconG, s.key, cx, y + 34);
      this.mainView.add(iconG);
      this.mainView.add(mkText(this.scene, cx, y + 58, s.label, 11, '#8a6d1a', true, true).setOrigin(0.5));
      const valText = mkText(this.scene, cx, y + 80, '0', 24, ORCHARD.textDark, true, true).setOrigin(0.5);
      this.mainView.add(valText);
      return valText;
    });

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
    const y = LAYOUT.contentHeight - 16 - AC_H;
    const bg = this.scene.add.graphics();
    bg.fillStyle(ORCHARD.cream, 0.97);
    bg.fillRoundedRect(AC_X, y, AC_W, AC_H, 14);
    bg.lineStyle(1.5, ORCHARD.gold, 0.75);
    bg.strokeRoundedRect(AC_X, y, AC_W, AC_H, 14);
    this.mainView.add(bg);

    this.mainView.add(mkText(this.scene, AC_X + AC_PAD, y + 12, 'CULTIVATION', 12, '#8a6d1a', true, true));

    // Cultivation segmented control, restyled onto the Orchard palette:
    // SELECTED = deep forest fill + warm cream text + a subtle gold accent
    // border; UNSELECTED = a muted cream-green "secondary" fill + dark
    // olive text — no more generic prototype grey.
    const policies: { id: CultivationPolicy; label: string }[] = [
      { id: 'NORMAL', label: 'NORMAL' },
      { id: 'SWEETEN', label: 'SWEETEN' },
      { id: 'GROW_BIG', label: 'GROW BIG' },
    ];
    const segW = (AC_W - AC_PAD * 2 - 12) / 3;
    const segY = y + 32;
    this.cultivationBtns = policies.map((p, i) => {
      const active = (field.pendingPolicy ?? field.policy) === p.id;
      const btn = new Button(
        this.scene,
        AC_X + AC_PAD + segW / 2 + i * (segW + 6),
        segY + 20,
        segW,
        40,
        p.label,
        () => {
          this.game.setFieldPolicy(field.id, p.id);
          this.render();
        },
        active ? ORCHARD.forestDeep : SECONDARY_BG,
        16,
        false,
        active ? ORCHARD.textWarmLight : ORCHARD.textDark,
      );
      btn.setAccent(active);
      this.mainView.add(btn);
      return { btn, policy: p.id };
    });

    // CHANGE VARIETY — deliberately a smaller, lighter secondary action
    // (same muted "secondary" tone as an unselected Cultivation segment)
    // rather than a full-width saturated CTA, so it doesn't compete with
    // HARVEST ALL below.
    const changeVarietyY = segY + 56;
    const cvW = 200;
    this.changeVarietyBtn = new Button(
      this.scene,
      AC_X + AC_PAD + cvW / 2,
      changeVarietyY + 18,
      cvW,
      36,
      'CHANGE VARIETY',
      () => this.openVarietyPicker(field.id),
      SECONDARY_BG,
      15,
      false,
      ORCHARD.textDark,
    );
    this.mainView.add(this.changeVarietyBtn);

    // Bottom row: Packing (compact, informational/clickable) + HARVEST ALL
    // — the primary Orchard action, given the most width/weight in the card.
    const bottomRowY = changeVarietyY + 50;
    const harvestW = 240;
    const harvestH = 56;
    this.packingText = mkText(this.scene, AC_X + AC_PAD, bottomRowY + harvestH / 2, '', 19, ORCHARD.textDark, true, true).setOrigin(0, 0.5);
    this.mainView.add(this.packingText);
    const packingZoneW = AC_W - AC_PAD - harvestW - 12 - AC_PAD;
    const packingZone = this.scene.add.zone(AC_X, bottomRowY, packingZoneW, harvestH).setOrigin(0, 0);
    packingZone.setInteractive({ useHandCursor: true });
    packingZone.on('pointerdown', () => openShippingInfraModal(this.scene, this.game));
    this.mainView.add(packingZone);

    // HARVEST ALL — forest green (not gold, which stays reserved for END
    // DAY/restrained accents), the strongest action in this card by both
    // width and a gold accent border.
    const anyRipe = field.slots.some((s) => s.ripe);
    this.harvestBtn = new Button(
      this.scene,
      AC_X + AC_W - AC_PAD - harvestW / 2,
      bottomRowY + harvestH / 2,
      harvestW,
      harvestH,
      'HARVEST ALL',
      () => this.treeLayer.harvestAllRemaining(),
      anyRipe ? ORCHARD.forestDeep : 0x9c9484,
      20,
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
