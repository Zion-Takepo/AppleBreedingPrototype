import Phaser from 'phaser';
import { TUNING, type ContestType } from '../tuning.ts';
import { contestCriteriaLines, contestTypeLabel } from '../systems/contest.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

/**
 * Small, read-only info modal for whichever Contest the HUD's NEXT CONTEST /
 * CONTEST TODAY headline is currently pointing at (see PROJECT.md "Contest"
 * section 8) — name, day, judging criteria, prizes. Never shows/edits any
 * entry state; that only ever happens through the Closing -> Contest flow.
 */
export function openContestInfoModal(scene: Phaser.Scene, day: number, type: ContestType): void {
  const modal = createModal(scene, 620, 440, THEME.panelBg);
  const cx = modal.x + modal.w / 2;

  const closeBtn = new Button(scene, modal.x + modal.w - 40, modal.y + 36, 52, 40, 'X', () => modal.close(), THEME.danger, 22);
  modal.root.add(closeBtn);

  modal.root.add(mkText(scene, cx, modal.y + 32, contestTypeLabel(type), 34, THEME.textDark, true).setOrigin(0.5, 0));
  modal.root.add(mkText(scene, cx, modal.y + 78, `DAY ${day}`, 22, THEME.textMid, true, true).setOrigin(0.5, 0));

  let ry = modal.y + 150;
  modal.root.add(mkText(scene, modal.x + 60, ry, 'JUDGING CRITERIA', 20, THEME.textMid, true));
  ry += 36;
  for (const line of contestCriteriaLines(type)) {
    modal.root.add(mkText(scene, modal.x + 60, ry, `•  ${line}`, 24, THEME.textDark));
    ry += 34;
  }

  ry += 24;
  modal.root.add(mkText(scene, modal.x + 60, ry, 'PRIZES', 20, THEME.textMid, true));
  ry += 36;
  const prizeRows: [string, string][] = [
    ['1st place', `$${TUNING.CONTEST_PRIZES[0]}`],
    ['2nd place', `$${TUNING.CONTEST_PRIZES[1]}`],
    ['3rd place', `$${TUNING.CONTEST_PRIZES[2]}`],
    ['4th - 6th place', '$0'],
  ];
  prizeRows.forEach(([label, val]) => {
    modal.root.add(mkText(scene, modal.x + 60, ry, label, 22, THEME.textDark));
    modal.root.add(mkText(scene, modal.x + modal.w - 60, ry, val, 22, THEME.textDark, true, true).setOrigin(1, 0));
    ry += 32;
  });
}
