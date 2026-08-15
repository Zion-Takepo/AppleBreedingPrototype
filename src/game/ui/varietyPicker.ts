import type Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Variety } from '../types.ts';
import { THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

export function openVarietyPickerModal(
  scene: Phaser.Scene,
  game: Game,
  title: string,
  onPick: (variety: Variety) => void,
  filter?: (v: Variety) => boolean,
): void {
  const state = game.state;
  const list = filter ? state.library.filter(filter) : state.library;
  const rowH = 60;
  const h = Math.min(680, 120 + list.length * rowH);
  const modal = createModal(scene, 720, h, THEME.panelBg);
  modal.root.add(mkText(scene, modal.x + 32, modal.y + 24, title, 28, THEME.textDark, true));

  const closeBtn = new Button(scene, modal.x + modal.w - 44, modal.y + 32, 56, 44, 'X', () => modal.close(), THEME.danger, 24);
  modal.root.add(closeBtn);

  list.forEach((v, i) => {
    const ry = modal.y + 88 + i * rowH;
    if (ry > modal.y + h - 40) return;
    const rowBg = panel(scene, modal.x + 20, ry, modal.w - 40, rowH - 8, THEME.panelBg2, THEME.panelBorder, 12);
    modal.root.add(rowBg);
    modal.root.add(
      mkText(
        scene,
        modal.x + 36,
        ry + (rowH - 8) / 2,
        `${v.customName} (Gen ${v.generation})  S${v.sweetness}/Z${v.size}/Y${v.yieldStat}`,
        20,
        THEME.textDark,
        false,
        true,
      ).setOrigin(0, 0.5),
    );
    const zone = scene.add.zone(modal.x + 20, ry, modal.w - 40, rowH - 8).setOrigin(0, 0);
    zone.setInteractive();
    zone.on('pointerdown', () => {
      onPick(v);
      modal.close();
    });
    modal.root.add(zone);
  });

  if (list.length === 0) {
    modal.root.add(mkText(scene, modal.x + 32, modal.y + 100, 'No varieties available.', 22, THEME.textMid));
  }
}
