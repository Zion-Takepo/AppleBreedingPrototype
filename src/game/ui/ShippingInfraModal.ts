import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { packingCapacityForLevel, packingUpgradeCost, shippingCadenceForLevel, shippingSpeedUpgradeCost } from '../systems/economy.ts';
import { TUNING } from '../tuning.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

const MODAL_W = 760;
const MODAL_H = 460;
const MARGIN_X = 60;
const COLUMN_W = (MODAL_W - MARGIN_X * 2 - 40) / 2;

/**
 * Minimal Shipping Infrastructure upgrade panel (see PROJECT.md "Shipping
 * Infrastructure" sections 13-14) — two independent, permanent farm
 * upgrade tracks: Packing Capacity (Game.buyPackingCapacityUpgrade) and
 * Shipping Speed (Game.buyShippingSpeedUpgrade). Deliberately compact, no
 * new bottom-nav tab, no animation beyond this codebase's existing modal
 * open tween (see createModal). Opened from the Orchard's Packing Box
 * display (see OrchardScreen.ts) — normal Orchard/farm interaction, so
 * nothing here needs to special-case Closing/Breed-pause beyond what
 * already blocks reaching this modal in the first place.
 */
export function openShippingInfraModal(scene: Phaser.Scene, game: Game): void {
  const modal = createModal(scene, MODAL_W, MODAL_H, THEME.panelBg);

  modal.root.add(mkText(scene, modal.x + MARGIN_X, modal.y + 28, 'SHIPPING INFRASTRUCTURE', 28, THEME.textDark, true));
  const closeBtn = new Button(scene, modal.x + MODAL_W - 44, modal.y + 36, 56, 44, 'X', () => modal.close(), THEME.danger, 24);
  modal.root.add(closeBtn);

  const colAX = modal.x + MARGIN_X;
  const colBX = colAX + COLUMN_W + 40;
  const topY = modal.y + 96;

  const packingElems = buildTrack(scene, modal.root, colAX, topY, COLUMN_W, {
    title: 'PACKING CAPACITY',
    currentLabel: () => `${packingCapacityForLevel(game.state.packingCapacityLevel)}`,
    nextLabel: () => {
      const next = game.state.packingCapacityLevel + 1;
      return next <= TUNING.PACKING_MAX_LEVEL ? `${packingCapacityForLevel(next)}` : null;
    },
    cost: () => packingUpgradeCost(game.state.packingCapacityLevel),
    canAfford: (cost) => game.state.cash >= cost,
    buy: () => game.buyPackingCapacityUpgrade(),
  });

  const speedElems = buildTrack(scene, modal.root, colBX, topY, COLUMN_W, {
    title: 'SHIPPING SPEED',
    currentLabel: () => `${shippingCadenceForLevel(game.state.shippingSpeedLevel).toFixed(2)}s/apple`,
    nextLabel: () => {
      const next = game.state.shippingSpeedLevel + 1;
      return next <= TUNING.SHIPPING_SPEED_MAX_LEVEL ? `${shippingCadenceForLevel(next).toFixed(2)}s/apple` : null;
    },
    cost: () => shippingSpeedUpgradeCost(game.state.shippingSpeedLevel),
    canAfford: (cost) => game.state.cash >= cost,
    buy: () => game.buyShippingSpeedUpgrade(),
  });

  // Small explanatory sentence connecting genetics to infrastructure (see
  // PROJECT.md "Freshness" section 14) — no new tab/inspector, just this
  // one line under the two tracks.
  modal.root.add(
    mkText(scene, modal.x + MODAL_W / 2, modal.y + MODAL_H - 34, 'Freshness protects apple value while waiting in Packing.', 16, THEME.textMid).setOrigin(0.5),
  );

  const refreshAll = () => {
    packingElems.refresh();
    speedElems.refresh();
  };
  refreshAll();

  // Re-render both tracks after every purchase attempt (success updates
  // level/cash; a rejected purchase — insufficient cash or already MAX —
  // leaves everything unchanged, so re-rendering is always safe/idempotent).
  packingElems.onBuyClicked = refreshAll;
  speedElems.onBuyClicked = refreshAll;

  // Live cash binding — this modal has no periodic refresh of its own
  // (unlike the HUD/active screen, which MainScene re-renders on its own
  // interval): without this, affordability could go stale while the modal
  // sits open and a background shipment pays cash into GameState.cash (see
  // Game.update()'s Shipping drain). Every element above already reads
  // game.state.cash/packingCapacityLevel/shippingSpeedLevel live via the
  // TrackSpec closures — never a second cached cash value — so simply
  // re-running refreshAll() every scene frame this modal is open keeps it
  // exactly current, torn down the instant the modal closes.
  scene.events.on('update', refreshAll);
  const rawClose = modal.close;
  modal.close = () => {
    scene.events.off('update', refreshAll);
    rawClose();
  };
}

interface TrackSpec {
  title: string;
  currentLabel: () => string;
  /** Null once the track is already at MAX. */
  nextLabel: () => string | null;
  /** Null once the track is already at MAX. */
  cost: () => number | null;
  canAfford: (cost: number) => boolean;
  buy: () => boolean;
}

interface TrackElems {
  refresh: () => void;
  onBuyClicked: (() => void) | null;
}

function buildTrack(scene: Phaser.Scene, root: Phaser.GameObjects.Container, x: number, y: number, w: number, spec: TrackSpec): TrackElems {
  const elems: TrackElems = { refresh: () => {}, onBuyClicked: null };

  root.add(mkText(scene, x, y, spec.title, 22, THEME.textDark, true));

  const currentLabel = mkText(scene, x, y + 44, '', 19, THEME.textMid);
  const currentValue = mkText(scene, x, y + 70, '', 26, THEME.textDark, true, true);
  const nextLabel = mkText(scene, x, y + 116, '', 19, THEME.textMid);
  const nextValue = mkText(scene, x, y + 142, '', 26, THEME.textDark, true, true);
  const costText = mkText(scene, x, y + 188, '', 19, THEME.textMid);
  root.add([currentLabel, currentValue, nextLabel, nextValue, costText]);

  currentLabel.setText('Current:');
  nextLabel.setText('Next:');

  const btn = new Button(scene, x + w / 2, y + 250, w, 52, 'UPGRADE', () => {
    if (spec.buy()) elems.onBuyClicked?.();
  }, THEME.accent, 22);
  root.add(btn);

  elems.refresh = () => {
    currentValue.setText(spec.currentLabel());
    const next = spec.nextLabel();
    const cost = spec.cost();
    if (next === null || cost === null) {
      nextLabel.setText('');
      nextValue.setText('MAX');
      costText.setText('');
      btn.setText('MAX').setEnabled(false);
    } else {
      nextLabel.setText('Next:');
      nextValue.setText(next);
      costText.setText(`Upgrade: $${cost}`);
      btn.setText('UPGRADE').setEnabled(spec.canAfford(cost));
    }
  };

  return elems;
}
