import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { WEEK1_CALENDAR, type DayDef } from '../systems/calendar.ts';
import { fairCompositeScore, sweetnessContestScore } from '../systems/economy.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';
import { ToastQueue } from './modals.ts';

export class CalendarScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private toasts: ToastQueue;
  private content: Phaser.GameObjects.Container;
  private selectedDay: number;

  constructor(scene: Phaser.Scene, game: Game, toasts: ToastQueue) {
    super(scene, 0, LAYOUT.contentTop);
    this.game = game;
    this.toasts = toasts;
    this.selectedDay = game.state.day;
    this.content = scene.add.container(0, 0);
    this.add(this.content);
    scene.add.existing(this);
  }

  render(): void {
    this.content.removeAll(true);
    const state = this.game.state;
    if (this.selectedDay > 7 || this.selectedDay < 1) this.selectedDay = state.day;

    this.drawWeekStrip();
    this.drawDetails();
  }

  private drawWeekStrip(): void {
    const state = this.game.state;
    const chipW = 216;
    const gap = 8;
    const startX = (LAYOUT.width - (chipW * 7 + gap * 6)) / 2;

    WEEK1_CALENDAR.forEach((def, i) => {
      const x = startX + i * (chipW + gap);
      const isToday = def.day === state.day;
      const isSelected = def.day === this.selectedDay;
      let color = THEME.panelBg2;
      if (def.event === 'CONTEST_SWEETNESS' || def.event === 'FAIR') color = THEME.gold;
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
    const def = WEEK1_CALENDAR.find((d) => d.day === this.selectedDay);
    if (!def) return;
    const state = this.game.state;
    const panelY = 128;
    const panelH = LAYOUT.contentHeight - panelY - 12;
    this.content.add(panel(this.scene, 24, panelY, LAYOUT.width - 48, panelH, THEME.panelBg, THEME.panelBorder, 20));

    this.content.add(mkText(this.scene, 52, panelY + 24, def.title, 30, THEME.textDark, true));

    if (def.day > state.day) {
      this.content.add(mkText(this.scene, 52, panelY + 80, 'This day has not arrived yet.', 24, THEME.textMid));
      return;
    }

    if (def.event === 'CONTEST_SWEETNESS') {
      this.drawContestUI(def, panelY);
    } else if (def.event === 'FAIR') {
      this.drawFairUI(def, panelY);
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
        return 'The Sweetness Contest is tomorrow. Consider breeding or using SWEETEN cultivation to prepare.';
      case 5:
        return 'Something unusual is stirring in the orchard today. Try breeding to see what turns up.';
      case 6:
        return 'Purple and Striped apples are in high demand today.';
      default:
        return '';
    }
  }

  private drawContestUI(def: DayDef, panelY: number): void {
    const state = this.game.state;
    const already = state.contestResults.find((r) => r.day === def.day);
    if (already || state.day4ContestDone) {
      this.drawResultSummary(already, panelY);
      return;
    }

    this.content.add(
      mkText(this.scene, 52, panelY + 76, 'Submit your sweetest planted variety. Benchmarks: 1st ≥79, 2nd ≥72, 3rd ≥65 sweetness.', 22, THEME.textMid, false, true),
    );

    let row = 0;
    for (const field of this.game.unlockedFields()) {
      const variety = this.game.getVariety(field.varietyId);
      if (!variety) continue;
      const score = Math.round(sweetnessContestScore(variety, field.policy));
      this.drawSubmitRow(panelY + 132 + row * 68, variety.customName, score, () => {
        const result = this.game.submitSweetnessContest(field.id);
        if (result) this.announceResult(result.place, result.prize, result.score);
        this.render();
      });
      row++;
    }
  }

  private drawFairUI(def: DayDef, panelY: number): void {
    const state = this.game.state;
    const already = state.contestResults.find((r) => r.day === def.day);
    if (already || state.day7FairDone) {
      this.drawResultSummary(already, panelY);
      return;
    }

    this.content.add(
      mkText(this.scene, 52, panelY + 76, 'Submit your most impressive apple. Score blends sweetness, size, and rarity.', 22, THEME.textMid),
    );

    let row = 0;
    for (const field of this.game.unlockedFields()) {
      const variety = this.game.getVariety(field.varietyId);
      if (!variety) continue;
      const score = Math.round(fairCompositeScore(variety, field.policy));
      this.drawSubmitRow(panelY + 132 + row * 68, variety.customName, score, () => {
        const result = this.game.submitFair(field.id);
        if (result) this.announceResult(result.place, result.prize, result.score);
        this.render();
      });
      row++;
    }
  }

  private drawSubmitRow(y: number, name: string, score: number, onSubmit: () => void): void {
    this.content.add(panel(this.scene, 52, y, LAYOUT.width - 104, 56, THEME.panelBg2, THEME.panelBorder, 12));
    this.content.add(mkText(this.scene, 72, y + 28, `${name}  —  Score ${score}`, 22, THEME.textDark, false, true).setOrigin(0, 0.5));
    const btn = new Button(this.scene, LAYOUT.width - 200, y + 28, 240, 44, 'SUBMIT', onSubmit, THEME.accent, 20);
    this.content.add(btn);
  }

  private drawResultSummary(
    result: { place: 1 | 2 | 3 | 0; prize: number; score: number; varietyName: string } | undefined,
    panelY: number,
  ): void {
    if (!result) {
      this.content.add(mkText(this.scene, 52, panelY + 80, 'Already resolved.', 24, THEME.textMid));
      return;
    }
    const placeLabel = result.place === 0 ? 'No placement' : `${result.place === 1 ? '1st' : result.place === 2 ? '2nd' : '3rd'} place!`;
    this.content.add(
      mkText(
        this.scene,
        52,
        panelY + 80,
        `${result.varietyName} scored ${result.score}. ${placeLabel} ${result.prize > 0 ? `Prize: $${result.prize}` : ''}`,
        26,
        THEME.textDark,
        true,
        true,
      ),
    );
  }

  private announceResult(place: 1 | 2 | 3 | 0, prize: number, score: number): void {
    if (place === 0) {
      this.toasts.show(`No placement this time (score ${score}).`, THEME.danger);
    } else {
      this.toasts.show(`Placed ${place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'}! +$${prize}`, THEME.gold);
    }
  }
}
