import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { getDayDef, nextEvent } from '../systems/calendar.ts';
import { describeTopModifier } from '../systems/market.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';

export class HUD extends Phaser.GameObjects.Container {
  private game: Game;
  private dayText: Phaser.GameObjects.Text;
  private timerText: Phaser.GameObjects.Text;
  private cashText: Phaser.GameObjects.Text;
  private marketText: Phaser.GameObjects.Text;
  private eventText: Phaser.GameObjects.Text;
  private endDayBtn: Button;
  private onEndDay: () => void;

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

    this.endDayBtn = new Button(scene, LAYOUT.width - 124, y, 208, 48, 'END DAY', this.onEndDay, THEME.gold, 24);
    this.add(this.endDayBtn);

    scene.add.existing(this);
  }

  refresh(): void {
    const s = this.game.state;
    this.dayText.setText(`DAY ${s.day}`);
    const secs = Math.ceil(s.dayTimeRemaining);
    this.timerText.setText(s.dayActive ? `${secs}s left` : 'Day ended');
    this.cashText.setText(`$${Math.floor(s.cash)}`);

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
