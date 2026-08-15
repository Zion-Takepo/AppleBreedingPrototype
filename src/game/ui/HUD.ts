import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { getDayDef, nextEvent } from '../systems/calendar.ts';
import { describeTopModifier } from '../systems/market.ts';
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
    this.eventText = mkText(scene, 940, y, '', 24, '#cfe8c8').setOrigin(0, 0.5);
    this.add([this.dayText, this.timerText, this.cashText, this.marketText, this.eventText]);

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
    const secs = Math.ceil(s.dayTimeRemaining);
    this.timerText.setText(s.dayActive ? `${secs}s left` : 'Day ended');
    this.cashText.setText(`$${formatMoney(s.cash)}`);

    const marketDesc = describeTopModifier(s.marketModifiers);
    this.marketText.setText(marketDesc ? `Market: ${marketDesc}` : '');

    const def = getDayDef(s.day);
    if (def && def.event !== 'NONE') {
      this.eventText.setText(`TODAY: ${def.shortLabel}`);
    } else {
      const next = nextEvent(s.day);
      if (next) {
        this.eventText.setText(`Next: ${next.shortLabel} in ${next.day - s.day}d`);
      } else {
        this.eventText.setText('');
      }
    }

    this.endDayBtn.setEnabled(this.game.canEndDay());
    this.endDayBtn.setText(s.dayActive ? 'END DAY' : 'END DAY ✓');
  }
}
