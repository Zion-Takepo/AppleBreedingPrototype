import type Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { rarityScore } from '../systems/economy.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

export function showWeekSummary(scene: Phaser.Scene, game: Game, onStartWeek2: () => void): void {
  const state = game.state;
  const modal = createModal(scene, 960, 760, THEME.panelBg);
  const cx = modal.x + modal.w / 2;

  modal.root.add(mkText(scene, cx, modal.y + 28, 'WEEK 1 COMPLETE', 40, THEME.textDark, true).setOrigin(0.5, 0));

  const fieldsOwned = game.unlockedFields().length;
  const varietiesCreated = state.library.length - 2;
  const traitsDiscovered = state.discoveredColors.length + state.discoveredPatterns.length;
  const contestWins = state.contestResults.filter((r) => r.place === 1).length;
  const highestGen = Math.max(...state.library.map((v) => v.generation));
  const rarest = state.library.reduce((best, v) => (rarityScore(v) > rarityScore(best) ? v : best), state.library[0]);

  const stats: [string, string][] = [
    ['Fields Owned', `${fieldsOwned}`],
    ['Varieties Created', `${varietiesCreated}`],
    ['Traits Discovered', `${traitsDiscovered}`],
    ['Contest Wins', `${contestWins}`],
    ['Highest Sweetness', `${state.highestSweetnessEver}`],
    ['Largest Apple (Size)', `${state.largestSizeEver}`],
    // totalRevenue accumulates exact, unrounded per-apple dollars (see
    // priceHarvestedApple) — round only for this display.
    ['Total Revenue', `$${Math.round(state.totalRevenue)}`],
    ['Highest Generation', `${highestGen}`],
  ];

  const colX = [modal.x + 60, modal.x + 500];
  stats.forEach(([label, val], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = colX[col];
    const y = modal.y + 112 + row * 48;
    modal.root.add(mkText(scene, x, y, label, 22, THEME.textMid));
    modal.root.add(mkText(scene, x + 340, y, val, 24, THEME.textDark, true, true));
  });

  modal.root.add(mkText(scene, modal.x + 60, modal.y + 336, 'Rarest Variety', 24, THEME.textMid));
  if (rarest) {
    const apple = new AppleVisual(scene, modal.x + 104, modal.y + 432, 104);
    apple.draw({ visualId: rarest.visualId, size: rarest.size });
    modal.root.add(apple);
    modal.root.add(mkText(scene, modal.x + 180, modal.y + 396, rarest.customName, 28, THEME.textDark, true));
    modal.root.add(mkText(scene, modal.x + 180, modal.y + 436, `${rarest.color} / ${rarest.pattern}  •  Gen ${rarest.generation}`, 22, THEME.textMid, false, true));
  }

  const btn = new Button(scene, cx, modal.y + modal.h - 72, 440, 76, 'START WEEK 2 →', () => {
    modal.close();
    onStartWeek2();
  }, THEME.accent, 30);
  modal.root.add(btn);
}
