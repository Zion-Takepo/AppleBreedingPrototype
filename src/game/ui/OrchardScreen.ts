import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { CultivationPolicy, Field, Variety } from '../types.ts';
import { effectiveStats } from '../systems/economy.ts';
import { TUNING } from '../tuning.ts';
import { OrchardTreeLayer } from '../render/OrchardTreeLayer.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { ToastQueue } from './modals.ts';
import { openVarietyPickerModal } from './varietyPicker.ts';
import { catalogLabel } from '../render/appleAssets.ts';
import { openShippingInfraModal } from './ShippingInfraModal.ts';

// Ground y used by the (temporary) front-row trees, for positioning the
// shipment box relative to them. Kept in sync with OrchardTreeLayer's own
// front-row groundY.
const TREE_TRUNK_Y = 356;

export class OrchardScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private toasts: ToastQueue;
  private treeLayer: OrchardTreeLayer;
  private tabsRow: Phaser.GameObjects.Container;
  private mainView: Phaser.GameObjects.Container;
  private selectedFieldId = 1;

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
  private statLineText: Phaser.GameObjects.Text | null = null;
  private queueText: Phaser.GameObjects.Text | null = null;
  private shippingSpeedText: Phaser.GameObjects.Text | null = null;

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
    // next to the HUD cash total (see HUD.ts), not here.
    this.treeLayer = new OrchardTreeLayer(scene, game);
    this.tabsRow = scene.add.container(0, 0);
    this.mainView = scene.add.container(0, 0);
    this.add([this.treeLayer, this.tabsRow, this.mainView]);
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
    this.renderTabs();
    this.renderMain();
  }

  private renderTabs(): void {
    this.tabsRow.removeAll(true);
    const state = this.game.state;
    let x = 8;
    const tabH = 52;

    for (const field of state.fields) {
      if (!field.unlocked) continue;
      const variety = this.game.getVariety(field.varietyId);
      const label = variety ? variety.customName : `FIELD ${field.id}`;
      const w = Math.max(192, 32 + label.length * 13);
      const isActive = field.id === this.selectedFieldId;

      const g = this.scene.add.graphics();
      g.fillStyle(isActive ? THEME.accent : THEME.panelBg2, 1);
      g.fillRoundedRect(x, 0, w, tabH, 12);
      if (field.slots.some((s) => s.ripe)) {
        g.fillStyle(0xe0392b, 1);
        g.fillCircle(x + w - 16, 16, 8);
      }
      this.tabsRow.add(g);

      const t = mkText(this.scene, x + w / 2, tabH / 2, label, 22, isActive ? THEME.textLight : THEME.textDark, isActive).setOrigin(0.5);
      this.tabsRow.add(t);

      const zone = this.scene.add.zone(x, 0, w, tabH).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', () => {
        this.selectedFieldId = field.id;
        this.render();
      });
      this.tabsRow.add(zone);

      x += w + 12;
    }

    const nextId = state.fields.find((f) => !f.unlocked)?.id;
    if (nextId) {
      const w = 168;
      const price = this.priceForField(nextId);
      const g = this.scene.add.graphics();
      g.fillStyle(THEME.gold, 1);
      g.fillRoundedRect(x, 0, w, tabH, 12);
      this.tabsRow.add(g);
      const t = mkText(this.scene, x + w / 2, tabH / 2, `+ FIELD $${price}`, 20, THEME.textDark, true, true).setOrigin(0.5);
      this.tabsRow.add(t);
      const zone = this.scene.add.zone(x, 0, w, tabH).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', () => this.tryBuyField(nextId));
      this.tabsRow.add(zone);
    }
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
    // of those (cultivation policy, ripe-fruit count) in place instead.
    if (field.id !== this.mainViewFieldId || variety.id !== this.mainViewVarietyId) {
      this.mainView.removeAll(true);
      this.mainViewFieldId = field.id;
      this.mainViewVarietyId = variety.id;
      this.changeVarietyBtn = null;
      this.cultivationBtns = [];
      this.harvestBtn = null;
      this.statLineText = null;
      this.drawShipmentBox();
      this.buildInfoPanel(field, variety);
    } else {
      this.updateInfoPanel(field, variety);
    }
  }

  private drawShipmentBox(): void {
    // Nudged down slightly from the old single-row layout so it clears the
    // new back-row trees' canopy lobes. Minimal Shipping Infrastructure UI
    // (see PROJECT.md "Shipping Infrastructure" section 13) — no full
    // Orchard/global redesign yet, just enough to read the Packing Box's
    // live occupancy/capacity and Shipping cadence, and to reach the
    // compact upgrade panel. Still the same box footprint area as the old
    // placeholder, just taller for the second line and clickable.
    const boxX = LAYOUT.width - 220;
    const boxY = TREE_TRUNK_Y + 4;
    const boxW = 200;
    const boxH = 84;
    const boxG = this.scene.add.graphics();
    boxG.fillStyle(0x8a5a2e, 1);
    boxG.fillRoundedRect(boxX, boxY, boxW, boxH, 10);
    boxG.lineStyle(4, 0x5b3b1c, 1);
    boxG.strokeRoundedRect(boxX, boxY, boxW, boxH, 10);
    this.mainView.add(boxG);

    this.queueText = mkText(this.scene, boxX + boxW / 2, boxY + 24, '', 19, THEME.textLight, true).setOrigin(0.5);
    this.mainView.add(this.queueText);
    this.shippingSpeedText = mkText(this.scene, boxX + boxW / 2, boxY + 48, '', 17, THEME.textLight).setOrigin(0.5);
    this.mainView.add(this.shippingSpeedText);
    this.mainView.add(mkText(this.scene, boxX + boxW / 2, boxY + boxH - 14, 'TAP TO UPGRADE', 13, '#e8d9b8').setOrigin(0.5));

    const zone = this.scene.add.zone(boxX, boxY, boxW, boxH).setOrigin(0, 0);
    zone.setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => openShippingInfraModal(this.scene, this.game));
    this.mainView.add(zone);

    this.refreshQueueText();
  }

  private refreshQueueText(): void {
    const capacity = this.game.packingCapacity();
    this.queueText?.setText(`PACKING ${this.game.state.processingQueue.length}/${capacity}`);
    this.shippingSpeedText?.setText(`${this.game.shippingCadenceSeconds().toFixed(2)}s / apple`);
  }

  private buildInfoPanel(field: Field, variety: Variety): void {
    // The Orchard itself now communicates growth visually (each fruit
    // grows/reveals independently) so there's no global growth text/bar or
    // duplicate variety-name heading here anymore — the field tab above
    // already shows the variety name. Fixed, non-overlapping row positions,
    // pushed well clear of the trees/shipment box below them (which bottom
    // out around local y=420) so CHANGE VARIETY in particular doesn't read
    // as crowding the right-side tree.
    const statLineY = 480;
    const cultLabelY = 540;
    const buttonCenterY = 620;

    this.changeVarietyBtn = new Button(this.scene, 1360, statLineY, 260, 44, 'CHANGE VARIETY', () => this.openVarietyPicker(field.id), THEME.info, 20);
    this.mainView.add(this.changeVarietyBtn);

    const eff = effectiveStats(variety, field.policy);
    const statLine = `Sweetness ${Math.round(eff.sweetness)}  •  Size ${Math.round(eff.size)}  •  Yield ${variety.yieldStat}`;
    this.statLineText = mkText(this.scene, 16, statLineY, statLine, 22, THEME.textMid, false, true);
    this.mainView.add(this.statLineText);

    // A Rare/Epic-planted field grows its ordinary baseVisualId fruit, not
    // the Line's special identity visual (see PROJECT.md "Revise Rare /
    // Epic Line behavior") — a small note so that isn't mistaken for a
    // bug. Only depends on the planted Line, which only changes alongside
    // a full mainView rebuild, so no update()-time counterpart is needed.
    if (variety.visualId !== variety.baseVisualId) {
      const note = `Growing ${catalogLabel(variety.baseVisualId)} (Special Lineage: ${catalogLabel(variety.visualId)})`;
      this.mainView.add(mkText(this.scene, 16, statLineY + 26, note, 18, '#8a6d1a', true));
    }

    // Cultivation policy buttons
    const policies: { id: CultivationPolicy; label: string }[] = [
      { id: 'NORMAL', label: 'NORMAL' },
      { id: 'SWEETEN', label: 'SWEETEN' },
      { id: 'GROW_BIG', label: 'GROW BIG' },
    ];
    this.mainView.add(mkText(this.scene, 16, cultLabelY, 'Cultivation (affects next harvest):', 20, THEME.textMid));
    this.cultivationBtns = policies.map((p, i) => {
      const active = (field.pendingPolicy ?? field.policy) === p.id;
      const btn = new Button(
        this.scene,
        140 + i * 200,
        buttonCenterY,
        184,
        44,
        p.label,
        () => {
          this.game.setFieldPolicy(field.id, p.id);
          this.render();
        },
        active ? THEME.accentDark : 0x8a8570,
        20,
      );
      this.mainView.add(btn);
      return { btn, policy: p.id };
    });

    // HARVEST ALL — a small secondary convenience button. Direct
    // click/sweep harvesting on individual fruit is the primary
    // interaction now; this just visually harvests whatever fruit are
    // currently ripe (zero, some, or all 15) — it never requires the full
    // crop to be ripe.
    const anyRipe = field.slots.some((s) => s.ripe);
    this.harvestBtn = new Button(
      this.scene,
      LAYOUT.width - 200,
      buttonCenterY,
      200,
      56,
      'HARVEST ALL',
      () => this.treeLayer.harvestAllRemaining(),
      anyRipe ? THEME.gold : 0x9c9484,
      22,
    );
    this.harvestBtn.setEnabled(anyRipe);
    this.mainView.add(this.harvestBtn);
  }

  // Refreshes only the values that can change without a field/variety
  // switch (cultivation policy, ripe-fruit count) on the already-built,
  // still-alive Button/Text instances — no destroy/recreate, so a pointer
  // resting on one of these controls keeps its hover state stable instead
  // of re-triggering pointerover on a freshly-created GameObject every tick.
  private updateInfoPanel(field: Field, variety: Variety): void {
    const eff = effectiveStats(variety, field.policy);
    this.statLineText?.setText(`Sweetness ${Math.round(eff.sweetness)}  •  Size ${Math.round(eff.size)}  •  Yield ${variety.yieldStat}`);

    const effectivePolicy = field.pendingPolicy ?? field.policy;
    this.cultivationBtns.forEach(({ btn, policy }) => {
      btn.setColor(policy === effectivePolicy ? THEME.accentDark : 0x8a8570);
    });

    const anyRipe = field.slots.some((s) => s.ripe);
    this.harvestBtn?.setColor(anyRipe ? THEME.gold : 0x9c9484);
    this.harvestBtn?.setEnabled(anyRipe);

    this.refreshQueueText();
  }

  private openVarietyPicker(fieldId: number): void {
    openVarietyPickerModal(this.scene, this.game, 'Choose Variety to Plant', (v) => {
      this.game.plantVariety(fieldId, v.id);
      this.render();
    });
  }
}
