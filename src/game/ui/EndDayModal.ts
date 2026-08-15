import type Phaser from 'phaser';
import type { DayLogEntry } from '../types.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

export function showEndDaySummary(scene: Phaser.Scene, log: DayLogEntry, isLastDay: boolean, onContinue: () => void): void {
  const modal = createModal(scene, 720, 600, THEME.panelBg);
  const cx = modal.x + modal.w / 2;

  modal.root.add(mkText(scene, cx, modal.y + 32, `DAY ${log.day} COMPLETE`, 36, THEME.textDark, true, true).setOrigin(0.5, 0));

  const rows: [string, number | null][] = [
    ['Harvest Revenue', log.harvestRevenue],
    ['Market Bonus', log.marketBonus],
    ['Contest Prize', log.contestPrize],
    ['Expenses', -log.expenses],
  ];

  let ry = modal.y + 120;
  rows.forEach(([label, val]) => {
    const v = val ?? 0;
    const sign = v >= 0 ? '+' : '-';
    modal.root.add(mkText(scene, modal.x + 60, ry, label, 24, THEME.textMid));
    modal.root.add(mkText(scene, modal.x + modal.w - 60, ry, `${sign}$${Math.abs(v)}`, 24, THEME.textDark, true, true).setOrigin(1, 0));
    ry += 48;
  });

  const lineY = ry + 8;
  const lineG = scene.add.graphics();
  lineG.lineStyle(2, 0x000000, 0.2);
  lineG.lineBetween(modal.x + 60, lineY, modal.x + modal.w - 60, lineY);
  modal.root.add(lineG);

  const netY = lineY + 28;
  const netColor = log.net >= 0 ? '#2f5a20' : '#b23b3b';
  modal.root.add(mkText(scene, modal.x + 60, netY, 'NET', 28, THEME.textDark, true));
  modal.root.add(mkText(scene, modal.x + modal.w - 60, netY, `${log.net >= 0 ? '+' : '-'}$${Math.abs(log.net)}`, 28, netColor, true, true).setOrigin(1, 0));

  const btn = new Button(scene, cx, modal.y + modal.h - 64, 400, 68, isLastDay ? 'CONTINUE →' : 'NEXT DAY →', () => {
    modal.close();
    onContinue();
  }, THEME.gold, 28);
  modal.root.add(btn);
}
