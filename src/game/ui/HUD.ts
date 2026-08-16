import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { ContestType } from '../tuning.ts';
import { APPLE_CATALOG_NUMBER } from '../render/appleAssets.ts';
import { getDayDef, nextEvent } from '../systems/calendar.ts';
import { gameClockLabel } from '../systems/clock.ts';
import { formatMarketPct, strongestMover } from '../systems/market.ts';
import { openMarketOverview } from './MarketScreen.ts';
import { openContestInfoModal } from './ContestInfoModal.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, formatMoney, text as mkText } from './uiKit.ts';

// Where the compact shipment "+$" feedback rests, directly under the HUD's
// cash total (cashText below, at x=350) — not a HUD layout change, just a
// small transient label anchored just outside the HUD bar itself.
const SHIPMENT_FEEDBACK_X = 350;
const SHIPMENT_FEEDBACK_Y = LAYOUT.hudHeight + 20;
const SHIPMENT_FEEDBACK_RISE_PX = 14;
const SHIPMENT_FEEDBACK_DURATION_MS = 700;

export class HUD extends Phaser.GameObjects.Container {
  private game: Game;
  private dayText: Phaser.GameObjects.Text;
  private timerText: Phaser.GameObjects.Text;
  private cashText: Phaser.GameObjects.Text;
  private marketText: Phaser.GameObjects.Text;
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

    const bg = scene.add.graphics();
    bg.fillStyle(THEME.hudBg, 1);
    bg.fillRect(0, 0, LAYOUT.width, LAYOUT.hudHeight);
    this.add(bg);

    const y = LAYOUT.hudHeight / 2;
    this.dayText = mkText(scene, 20, y, '', 26, THEME.textLight, true, true).setOrigin(0, 0.5);
    this.timerText = mkText(scene, 170, y, '', 24, THEME.textGold, false, true).setOrigin(0, 0.5);
    this.cashText = mkText(scene, 350, y, '', 26, '#a8e06a', true, true).setOrigin(0, 0.5);
    this.marketText = mkText(scene, 560, y, '', 24, THEME.textLight).setOrigin(0, 0.5);
    this.eventText = mkText(scene, 930, y, '', 19, '#cfe8c8').setOrigin(0, 0.5);
    this.add([this.dayText, this.timerText, this.cashText, this.marketText, this.eventText]);

    // Market V1's smallest access path: the existing HUD Market headline
    // opens the Market overview modal directly — no new bottom-nav tab, no
    // HUD reorder (see PROJECT.md "How to access Market"). Zone sized to
    // cover the headline's text run without encroaching on cashText/
    // eventText's own hit areas.
    const marketZone = scene.add.zone(550, 0, 370, LAYOUT.hudHeight).setOrigin(0, 0);
    marketZone.setInteractive();
    marketZone.on('pointerdown', () => openMarketOverview(scene, game));
    this.add(marketZone);

    // NEXT CONTEST / CONTEST TODAY headline (see PROJECT.md "Contest"
    // section 8) — clicking it opens a small Contest info modal for
    // whichever Contest eventText is currently describing (today's, if
    // pending, otherwise the upcoming one — see refresh() below).
    const contestZone = scene.add.zone(930, 0, 430, LAYOUT.hudHeight).setOrigin(0, 0);
    contestZone.setInteractive();
    contestZone.on('pointerdown', () => {
      if (this.hudContestDay !== null && this.hudContestType !== null) {
        openContestInfoModal(scene, this.hudContestDay, this.hudContestType);
      }
    });
    this.add(contestZone);

    this.shipmentText = mkText(scene, SHIPMENT_FEEDBACK_X, SHIPMENT_FEEDBACK_Y, '', 20, '#2f5a20', true, true).setOrigin(0, 0);
    this.shipmentText.setAlpha(0);
    this.add(this.shipmentText);

    this.endDayBtn = new Button(scene, LAYOUT.width - 124, y, 208, 48, 'END DAY', this.onEndDay, THEME.gold, 24);
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

  // Compact "+$X.XX" under the cash total: fades in place, drifts lightly
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
    this.dayText.setText(`DAY ${s.day}`);
    // Ended state lives in this same DAY/TIME area (not a separate "Day
    // ended" item) — see PROJECT.md Day Cycle. Full future HUD
    // reorder/redesign is intentionally out of scope for this pass.
    if (s.dayEnded) {
      this.timerText.setText('· CLOSED');
    } else if (s.closing) {
      this.timerText.setText('· CLOSING…');
    } else {
      this.timerText.setText(`· ${gameClockLabel(s.dayTimeRemaining)}`);
    }
    this.cashText.setText(`$${formatMoney(s.cash)}`);

    // Deterministic headline from the actual Market V1 state: the strongest
    // notable mover among currently DISCOVERED Visual Varieties (see
    // systems/market.ts strongestMover). Catalog number only — never the
    // internal visualId.
    const mover = strongestMover(s.visualMarket, s.discoveredVisualIds);
    if (!mover || Math.abs(mover.pct) < 0.005) {
      this.marketText.setText('Market: steady ▸');
    } else {
      const num = String(APPLE_CATALOG_NUMBER[mover.visualId]).padStart(3, '0');
      this.marketText.setText(`Market: #${num} ${formatMarketPct(mover.pct)} ▸`);
    }

    // NEXT CONTEST / CONTEST TODAY (see PROJECT.md "Contest" section 8) —
    // Contest is the only scheduled Calendar event left in V1, so `today`
    // here is only ever 'CONTEST' or 'NONE'. Once today's Contest has
    // resolved, this switches back to pointing at the next one, same day or
    // not (see the `todayPending` check below).
    const today = getDayDef(s.day);
    const todayPending = today.event === 'CONTEST' && !(s.contest?.day === s.day && s.contest.resolved);
    if (todayPending) {
      this.eventText.setText(`CONTEST TODAY · ${today.title}`);
      this.hudContestDay = today.day;
      this.hudContestType = today.contestType ?? null;
    } else {
      const next = nextEvent(s.day);
      this.eventText.setText(`NEXT CONTEST · DAY ${next.day} · ${next.title}`);
      this.hudContestDay = next.day;
      this.hudContestType = next.contestType ?? null;
    }

    this.endDayBtn.setEnabled(this.game.canEndDay());
    this.endDayBtn.setText(s.closing ? 'CLOSING…' : s.dayEnded ? 'END DAY ✓' : 'END DAY');
  }
}
