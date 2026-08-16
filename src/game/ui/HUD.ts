import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { ContestType } from '../tuning.ts';
import { APPLE_CATALOG_NUMBER } from '../render/appleAssets.ts';
import { getDayDef, nextEvent } from '../systems/calendar.ts';
import { gameClockLabel } from '../systems/clock.ts';
import { formatMarketPct, strongestMover } from '../systems/market.ts';
import { openMarketOverview } from './MarketScreen.ts';
import { openContestInfoModal } from './ContestInfoModal.ts';
import { LAYOUT, ORCHARD, THEME } from './theme.ts';
import { Button, formatMoney, text as mkText } from './uiKit.ts';

// Orchard UI redesign (see PROJECT.md "Orchard UI redesign"): the top HUD is
// several independent deep-forest cards with visible gaps between them —
// the sky stays visible — instead of one continuous full-width strip. Every
// card still shows only real, existing GameState (day/time, cash, market,
// contest, end day) — no invented currencies/resources.
const CARD_Y = 14;
const CARD_H = 56;
const CARD_GAP = 10;
const CARD_RADIUS = 12;

const DAY_CARD_X = 16;
const DAY_CARD_W = 230;
const CASH_CARD_X = DAY_CARD_X + DAY_CARD_W + CARD_GAP;
const CASH_CARD_W = 170;
const MARKET_CARD_X = CASH_CARD_X + CASH_CARD_W + CARD_GAP;
const MARKET_CARD_W = 290;
const CONTEST_CARD_X = MARKET_CARD_X + MARKET_CARD_W + CARD_GAP;
const CONTEST_CARD_W = 380;
const END_DAY_CARD_W = 208;
const END_DAY_CARD_X = LAYOUT.width - 16 - END_DAY_CARD_W;

// Compact shipment "+$" feedback, directly under the CASH card.
const SHIPMENT_FEEDBACK_X = CASH_CARD_X + CASH_CARD_W / 2;
const SHIPMENT_FEEDBACK_Y = CARD_Y + CARD_H + 6;
const SHIPMENT_FEEDBACK_RISE_PX = 14;
const SHIPMENT_FEEDBACK_DURATION_MS = 700;

/** Draws one deep-forest card shell with a thin, restrained gold border. */
function drawCard(scene: Phaser.Scene, x: number, w: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(ORCHARD.forestDeep, 1);
  g.fillRoundedRect(x, CARD_Y, w, CARD_H, CARD_RADIUS);
  g.lineStyle(1.5, ORCHARD.gold, 0.55);
  g.strokeRoundedRect(x, CARD_Y, w, CARD_H, CARD_RADIUS);
  return g;
}

function microLabel(scene: Phaser.Scene, x: number, str: string): Phaser.GameObjects.Text {
  return mkText(scene, x, CARD_Y + 9, str, 12, ORCHARD.goldStr, true, true).setOrigin(0, 0);
}

export class HUD extends Phaser.GameObjects.Container {
  private game: Game;
  private dayText: Phaser.GameObjects.Text;
  private cashText: Phaser.GameObjects.Text;
  private marketText: Phaser.GameObjects.Text;
  private eventLabel: Phaser.GameObjects.Text;
  private eventText: Phaser.GameObjects.Text;
  private endDayBtn: Button;
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

  constructor(scene: Phaser.Scene, game: Game, onEndDay: () => void) {
    super(scene, 0, 0);
    this.game = game;
    this.onEndDay = onEndDay;

    // DAY / TIME card
    this.add(drawCard(scene, DAY_CARD_X, DAY_CARD_W));
    this.add(microLabel(scene, DAY_CARD_X + 14, 'DAY / TIME'));
    this.dayText = mkText(scene, DAY_CARD_X + 14, CARD_Y + 26, '', 22, THEME.textLight, true, true).setOrigin(0, 0);
    this.add(this.dayText);

    // CASH card
    this.add(drawCard(scene, CASH_CARD_X, CASH_CARD_W));
    this.add(microLabel(scene, CASH_CARD_X + 14, 'CASH'));
    this.cashText = mkText(scene, CASH_CARD_X + 14, CARD_Y + 26, '', 22, '#c9e69a', true, true).setOrigin(0, 0);
    this.add(this.cashText);

    // MARKET card — clickable, opens the Market overview modal (unchanged
    // access path, just re-homed into its own card).
    this.add(drawCard(scene, MARKET_CARD_X, MARKET_CARD_W));
    this.add(microLabel(scene, MARKET_CARD_X + 14, 'MARKET'));
    this.marketText = mkText(scene, MARKET_CARD_X + 14, CARD_Y + 26, '', 19, THEME.textLight).setOrigin(0, 0);
    this.add(this.marketText);
    const marketZone = scene.add.zone(MARKET_CARD_X, CARD_Y, MARKET_CARD_W, CARD_H).setOrigin(0, 0);
    marketZone.setInteractive({ useHandCursor: true });
    marketZone.on('pointerdown', () => openMarketOverview(scene, game));
    this.add(marketZone);

    // CONTEST card — clickable, opens Contest info for whichever Contest
    // eventText currently describes (today's, if pending, otherwise the
    // upcoming one — see refresh() below).
    this.add(drawCard(scene, CONTEST_CARD_X, CONTEST_CARD_W));
    this.eventLabel = microLabel(scene, CONTEST_CARD_X + 14, 'NEXT CONTEST');
    this.add(this.eventLabel);
    this.eventText = mkText(scene, CONTEST_CARD_X + 14, CARD_Y + 26, '', 18, THEME.textLight).setOrigin(0, 0);
    this.add(this.eventText);
    const contestZone = scene.add.zone(CONTEST_CARD_X, CARD_Y, CONTEST_CARD_W, CARD_H).setOrigin(0, 0);
    contestZone.setInteractive({ useHandCursor: true });
    contestZone.on('pointerdown', () => {
      if (this.hudContestDay !== null && this.hudContestType !== null) {
        openContestInfoModal(scene, this.hudContestDay, this.hudContestType);
      }
    });
    this.add(contestZone);

    this.shipmentText = mkText(scene, SHIPMENT_FEEDBACK_X, SHIPMENT_FEEDBACK_Y, '', 18, '#c9e69a', true, true).setOrigin(0.5, 0);
    this.shipmentText.setAlpha(0);
    this.add(this.shipmentText);

    // END DAY — the strongest, top-right action, unchanged behavior.
    this.endDayBtn = new Button(scene, END_DAY_CARD_X + END_DAY_CARD_W / 2, CARD_Y + CARD_H / 2, END_DAY_CARD_W, CARD_H, 'END DAY', this.onEndDay, THEME.gold, 22);
    this.add(this.endDayBtn);

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

  refresh(): void {
    const s = this.game.state;
    // Ended state lives in this same DAY/TIME card (not a separate "Day
    // ended" item) — see PROJECT.md Day Cycle.
    if (s.dayEnded) {
      this.dayText.setText(`DAY ${s.day} · CLOSED`);
    } else if (s.closing) {
      this.dayText.setText(`DAY ${s.day} · CLOSING…`);
    } else {
      this.dayText.setText(`DAY ${s.day} · ${gameClockLabel(s.dayTimeRemaining)}`);
    }
    this.cashText.setText(`$${formatMoney(s.cash)}`);

    // Deterministic headline from the actual Market V1 state: the strongest
    // notable mover among currently DISCOVERED Visual Varieties (see
    // systems/market.ts strongestMover). Catalog number only — never the
    // internal visualId.
    const mover = strongestMover(s.visualMarket, s.discoveredVisualIds);
    if (!mover || Math.abs(mover.pct) < 0.005) {
      this.marketText.setText('Steady ▸');
    } else {
      const num = String(APPLE_CATALOG_NUMBER[mover.visualId]).padStart(3, '0');
      this.marketText.setText(`#${num} ${formatMarketPct(mover.pct)} ▸`);
    }

    // NEXT CONTEST / CONTEST TODAY (see PROJECT.md "Contest" section 8) —
    // Contest is the only scheduled Calendar event left in V1, so `today`
    // here is only ever 'CONTEST' or 'NONE'. Once today's Contest has
    // resolved, this switches back to pointing at the next one, same day or
    // not (see the `todayPending` check below).
    const today = getDayDef(s.day);
    const todayPending = today.event === 'CONTEST' && !(s.contest?.day === s.day && s.contest.resolved);
    if (todayPending) {
      this.eventLabel.setText('CONTEST TODAY');
      this.eventText.setText(`${today.title} ▸`);
      this.hudContestDay = today.day;
      this.hudContestType = today.contestType ?? null;
    } else {
      const next = nextEvent(s.day);
      this.eventLabel.setText('NEXT CONTEST');
      this.eventText.setText(`DAY ${next.day} · ${next.title} ▸`);
      this.hudContestDay = next.day;
      this.hudContestType = next.contestType ?? null;
    }

    this.endDayBtn.setEnabled(this.game.canEndDay());
    this.endDayBtn.setText(s.closing ? 'CLOSING…' : s.dayEnded ? 'END DAY ✓' : 'END DAY');
  }
}
