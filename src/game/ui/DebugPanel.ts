import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';

export class DebugPanel extends Phaser.GameObjects.Container {
  private game: Game;
  private getSpeed: () => number;
  private setSpeed: (mult: number) => void;
  private expanded = false;
  private panelContainer: Phaser.GameObjects.Container;
  private toggleBtn: Button;

  constructor(scene: Phaser.Scene, game: Game, getSpeed: () => number, setSpeed: (mult: number) => void) {
    super(scene, 0, 0);
    this.game = game;
    this.getSpeed = getSpeed;
    this.setSpeed = setSpeed;
    this.setDepth(3000);

    this.toggleBtn = new Button(scene, LAYOUT.width - 40, LAYOUT.height - 12, 68, 32, 'DBG', () => {
      this.expanded = !this.expanded;
      this.rebuild();
    }, 0x555555, 18);
    this.add(this.toggleBtn);

    this.panelContainer = scene.add.container(0, 0);
    this.add(this.panelContainer);

    scene.add.existing(this);
    this.rebuild();
  }

  private rebuild(): void {
    this.panelContainer.removeAll(true);
    if (!this.expanded) return;

    const w = 320;
    const h = 260;
    const x = LAYOUT.width - w - 20;
    const y = LAYOUT.height - h - 52;
    this.panelContainer.add(panel(this.scene, x, y, w, h, 0x1e1e1e, 0x555555, 12));
    this.panelContainer.add(mkText(this.scene, x + 16, y + 12, 'DEBUG TOOLS', 20, '#ffffff', true));

    const addMoneyBtn = new Button(this.scene, x + w / 2, y + 60, w - 32, 44, '+ $200', () => {
      this.game.state.cash += 200;
      this.game.save();
    }, 0x4c8a3a, 20);
    this.panelContainer.add(addMoneyBtn);

    const skipDayBtn = new Button(this.scene, x + w / 2, y + 112, w - 32, 44, 'Skip Day Timer', () => {
      this.game.state.dayTimeRemaining = 0;
    }, 0xb2843b, 20);
    this.panelContainer.add(skipDayBtn);

    const speedLabel = this.getSpeed() > 1 ? `Speed x${this.getSpeed()} (tap)` : 'Speed x1 (tap)';
    const speedBtn = new Button(this.scene, x + w / 2, y + 164, w - 32, 44, speedLabel, () => {
      const next = this.getSpeed() >= 5 ? 1 : this.getSpeed() * 5;
      this.setSpeed(next);
      this.rebuild();
    }, 0x3b6db2, 20);
    this.panelContainer.add(speedBtn);

    const resetBtn = new Button(this.scene, x + w / 2, y + 216, w - 32, 44, 'RESET PROTOTYPE', () => {
      this.game.resetPrototype();
      window.location.reload();
    }, THEME.danger, 18);
    this.panelContainer.add(resetBtn);
  }
}
