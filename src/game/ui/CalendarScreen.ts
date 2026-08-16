import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { TUNING } from '../tuning.ts';
import { calendarWindowForDay, getDayDef, type DayDef } from '../systems/calendar.ts';
import { contestCriteriaLines } from '../systems/contest.ts';
import { LAYOUT, THEME } from './theme.ts';
import { panel, text as mkText } from './uiKit.ts';
import { ToastQueue } from './modals.ts';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export class CalendarScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private content: Phaser.GameObjects.Container;
  private selectedDay: number;

  constructor(scene: Phaser.Scene, game: Game, _toasts: ToastQueue) {
    super(scene, 0, LAYOUT.contentTop);
    this.game = game;
    this.selectedDay = game.state.day;
    this.content = scene.add.container(0, 0);
    this.add(this.content);
    scene.add.existing(this);
  }

  render(): void {
    this.content.removeAll(true);
    const state = this.game.state;
    const window = calendarWindowForDay(state.day);
    const minDay = window[0].day;
    const maxDay = window[window.length - 1].day;
    if (this.selectedDay < minDay || this.selectedDay > maxDay) this.selectedDay = state.day;

    this.drawWeekStrip(window);
    this.drawDetails();
  }

  private drawWeekStrip(window: DayDef[]): void {
    const state = this.game.state;
    const chipW = 216;
    const gap = 8;
    const startX = (LAYOUT.width - (chipW * 7 + gap * 6)) / 2;

    window.forEach((def, i) => {
      const x = startX + i * (chipW + gap);
      const isToday = def.day === state.day;
      const isSelected = def.day === this.selectedDay;
      let color = THEME.panelBg2;
      if (def.event === 'CONTEST') color = THEME.gold;
      else if (def.scriptedMarket) color = THEME.info;
      if (def.day > state.day) color = 0xb9b39c;

      const g = this.scene.add.graphics();
      g.fillStyle(color, 1);
      g.fillRoundedRect(x, 8, chipW, 92, 12);
      if (isToday) {
        g.lineStyle(6, THEME.accentDark, 1);
        g.strokeRoundedRect(x, 8, chipW, 92, 12);
      } else if (isSelected) {
        g.lineStyle(4, 0x2b2b20, 0.6);
        g.strokeRoundedRect(x, 8, chipW, 92, 12);
      }
      this.content.add(g);

      const textColor = def.day > state.day ? THEME.textMid : THEME.textDark;
      this.content.add(mkText(this.scene, x + chipW / 2, 28, `DAY ${def.day}${isToday ? ' •' : ''}`, 20, textColor, true, true).setOrigin(0.5, 0));
      const label = def.day > state.day + 2 && def.event === 'NONE' ? '' : def.shortLabel;
      this.content.add(
        mkText(this.scene, x + chipW / 2, 60, label, 20, textColor).setOrigin(0.5, 0).setAlign('center'),
      );

      const zone = this.scene.add.zone(x, 8, chipW, 92).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', () => {
        this.selectedDay = def.day;
        this.render();
      });
      this.content.add(zone);
    });
  }

  private drawDetails(): void {
    const def = getDayDef(this.selectedDay);
    const state = this.game.state;
    const panelY = 128;
    const panelH = LAYOUT.contentHeight - panelY - 12;
    this.content.add(panel(this.scene, 24, panelY, LAYOUT.width - 48, panelH, THEME.panelBg, THEME.panelBorder, 20));

    this.content.add(mkText(this.scene, 52, panelY + 24, def.title, 30, THEME.textDark, true));

    if (def.day > state.day) {
      this.content.add(mkText(this.scene, 52, panelY + 80, 'This day has not arrived yet.', 24, THEME.textMid));
      return;
    }

    if (def.event === 'CONTEST') {
      this.drawContestDetail(def, panelY);
    } else {
      this.content.add(mkText(this.scene, 52, panelY + 80, this.flavorFor(def.day), 24, THEME.textMid));
    }
  }

  private flavorFor(day: number): string {
    switch (day) {
      case 1:
        return 'Harvest your first apples and try your first breeding today.';
      case 2:
        return 'Yellow apples are selling for a premium today (+30%). Field 2 is now available to purchase.';
      case 3:
        return 'The first Contest — BIGGEST APPLE — is on Day 7. Consider breeding for Size.';
      case 5:
        return 'Something unusual is stirring in the orchard today. Try breeding to see what turns up.';
      case 6:
        return 'Purple and Striped apples are in high demand today.';
      default:
        return 'An ordinary day on the farm.';
    }
  }

  // Read-only: entry itself only ever happens through the Closing -> Contest
  // flow at 18:00 (see PROJECT.md "Contest" sections 11-13), never from
  // Calendar — this just answers "when is the next Contest, what type, and
  // (once it's happened) how did it go."
  private drawContestDetail(def: DayDef, panelY: number): void {
    const type = def.contestType!;
    const state = this.game.state;

    this.content.add(mkText(this.scene, 52, panelY + 72, `Judging: ${contestCriteriaLines(type).join('   •   ')}`, 22, THEME.textMid));
    this.content.add(
      mkText(
        this.scene,
        52,
        panelY + 104,
        `Prizes: 1st $${TUNING.CONTEST_PRIZES[0]}   •   2nd $${TUNING.CONTEST_PRIZES[1]}   •   3rd $${TUNING.CONTEST_PRIZES[2]}   •   4th-6th $0`,
        20,
        THEME.textMid,
      ),
    );

    const history = state.contestHistory.find((h) => h.day === def.day);
    let resultText: string;
    let resultColor = THEME.textDark;
    if (history) {
      if (history.rank === null) {
        resultText = 'No entry was submitted for this Contest.';
      } else {
        const place = ORDINALS[history.rank - 1] ?? `${history.rank}th`;
        resultText = history.prize > 0 ? `Placed ${place} — +$${history.prize}` : `Placed ${place} — no prize`;
        resultColor = history.rank === 1 ? '#2f5a20' : THEME.textDark;
      }
    } else if (def.day === state.day) {
      resultText = 'Resolves automatically at Closing (18:00) today.';
      resultColor = '#3b6db2';
    } else {
      resultText = 'This Contest has not resolved yet.';
    }
    this.content.add(mkText(this.scene, 52, panelY + 152, resultText, 24, resultColor, true));
  }
}
