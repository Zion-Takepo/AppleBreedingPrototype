import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { LAYOUT, THEME } from './theme.ts';
import { text as mkText } from './uiKit.ts';

export type ScreenId = 'ORCHARD' | 'BREED' | 'CALENDAR' | 'COLLECTION';

const TABS: { id: ScreenId; label: string }[] = [
  { id: 'ORCHARD', label: 'ORCHARD' },
  { id: 'BREED', label: 'BREED' },
  { id: 'CALENDAR', label: 'CALENDAR' },
  { id: 'COLLECTION', label: 'COLLECTION' },
];

export class BottomNav extends Phaser.GameObjects.Container {
  private game: Game;
  private onSelect: (id: ScreenId) => void;
  private activeTab: ScreenId = 'ORCHARD';
  private tabGfx: Phaser.GameObjects.Graphics[] = [];
  private tabLabels: Phaser.GameObjects.Text[] = [];
  private badges: Phaser.GameObjects.Arc[] = [];
  private tabW: number;

  constructor(scene: Phaser.Scene, game: Game, onSelect: (id: ScreenId) => void) {
    super(scene, 0, LAYOUT.contentBottom);
    this.game = game;
    this.onSelect = onSelect;
    this.tabW = LAYOUT.width / TABS.length;

    TABS.forEach((tab, i) => {
      const x = i * this.tabW;
      const g = scene.add.graphics();
      this.add(g);
      this.tabGfx.push(g);

      const label = mkText(scene, x + this.tabW / 2, LAYOUT.navHeight / 2, tab.label, 24, THEME.textLight, true).setOrigin(0.5);
      this.add(label);
      this.tabLabels.push(label);

      const badge = scene.add.circle(x + this.tabW / 2 + 68, LAYOUT.navHeight / 2 - 20, 8, 0xe0392b);
      badge.setStrokeStyle(2, 0xffffff);
      badge.setVisible(false);
      this.add(badge);
      this.badges.push(badge);

      const zone = scene.add.zone(x, 0, this.tabW, LAYOUT.navHeight).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', () => this.onSelect(tab.id));
      this.add(zone);
    });

    scene.add.existing(this);
    this.redraw();
  }

  selectTab(id: ScreenId): void {
    this.activeTab = id;
    this.redraw();
  }

  refresh(): void {
    const pending = [this.game.hasHarvestReady(), this.game.hasBreedingResultPending(), false, this.game.state.hasUnseenDiscovery];
    pending.forEach((p, i) => this.badges[i].setVisible(p));
  }

  private redraw(): void {
    TABS.forEach((tab, i) => {
      const g = this.tabGfx[i];
      g.clear();
      const isActive = tab.id === this.activeTab;
      g.fillStyle(isActive ? THEME.navActive : THEME.navBg, 1);
      g.fillRect(i * this.tabW, 0, this.tabW, LAYOUT.navHeight);
      if (i > 0) {
        g.lineStyle(2, 0x000000, 0.25);
        g.lineBetween(i * this.tabW, 0, i * this.tabW, LAYOUT.navHeight);
      }
    });
    this.refresh();
  }
}
