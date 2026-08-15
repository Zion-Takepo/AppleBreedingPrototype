import Phaser from 'phaser';
import type { Variety } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { RadarChart } from './RadarChart.ts';
import { THEME } from './theme.ts';
import { panel, text as mkText } from './uiKit.ts';

export interface LineCardOptions {
  /** Apple illustration size in px. Defaults to a fraction of card height. */
  appleSizePx?: number;
  /** Mini radar radius in px. Defaults to a fraction of card height. */
  radarRadius?: number;
  /** Whether the radar draws its axis labels — off by default for compact grid use, on for large parent/detail use. */
  radarLabels?: boolean;
  /** Highlights the card as the currently previewed/selected one. */
  selected?: boolean;
  /** Shows a toggleable favorite star in the top-right corner. */
  showFavoriteStar?: boolean;
  /** Whole-card click (select/preview) — never mutates anything itself. */
  onClick?: () => void;
  /** Fires only when the favorite star itself is clicked, independent of onClick. */
  onToggleFavorite?: () => void;
}

const STAR_FILLED = '#c9962c';
const STAR_EMPTY = '#a89a6a';

/**
 * Reusable card for one Owned Line: apple image, customName, visual-variety
 * id + rarity, Gen, and a mini RadarChart, with an optional favorite star.
 * Purely presentational and read-only — clicking it only reports the click
 * via callbacks, it never selects/commits/mutates anything by itself. Used
 * both by LibraryPicker's compact grid and BreedScreen's large Parent A/B
 * slots (same component, different size options), and intended for reuse
 * by REPLANT / a future full Library screen.
 */
export class LineCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, line: Variety, opts: LineCardOptions = {}) {
    super(scene, x, y);
    const appleSizePx = opts.appleSizePx ?? Math.min(w, h * 0.4);
    const radarRadius = opts.radarRadius ?? Math.min(w, h) * 0.16;
    const radarLabels = opts.radarLabels ?? false;

    const borderColor = opts.selected ? THEME.accent : THEME.panelBorder;
    const bg = panel(scene, 0, 0, w, h, THEME.panelBg2, borderColor, 14);
    if (opts.selected) {
      bg.lineStyle(4, THEME.accent, 1);
      bg.strokeRoundedRect(1, 1, w - 2, h - 2, 13);
    }
    this.add(bg);

    const apple = new AppleVisual(scene, w / 2, appleSizePx / 2 + 14, appleSizePx);
    apple.draw({ visualId: line.visualId, size: line.size });
    this.add(apple);

    const rarity = APPLE_RARITY[line.visualId];
    const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';

    // Compact top-left catalog identifier (e.g. "COMMON · #001") replaces
    // the old separate "C1 • COMMON" text row — that row's reclaimed
    // vertical space goes to a visibly larger radar chart below.
    this.add(mkText(scene, 10, 10, catalogLabel(line.visualId), 13, rarityColor, rarity !== 'COMMON', true));

    // Fixed, modest font sizes (not scaled off card height — that caused
    // the radar chart below to collide with this text block on smaller
    // cards) laid out as a simple top-down flow so the radar is always
    // placed after wherever the text actually ended.
    const nameSize = 18;
    const genSize = 14;
    let ty = appleSizePx + 22;
    this.add(
      mkText(scene, w / 2, ty, line.customName, nameSize, THEME.textDark, true)
        .setOrigin(0.5, 0)
        .setAlign('center'),
    );
    ty += nameSize + 8;
    this.add(mkText(scene, w / 2, ty, `Gen ${line.generation}`, genSize, THEME.textMid, false, true).setOrigin(0.5, 0));
    ty += genSize + (radarLabels ? 34 : 10);

    const radar = new RadarChart(scene, w / 2, ty + radarRadius, radarRadius, radarLabels);
    radar.setValues(line);
    this.add(radar);

    // Whole-card hit zone first, so it's added (and thus stacked) below the
    // star's own small hit zone — Phaser's default topOnly input picks the
    // last-added overlapping interactive object, so the star must be added
    // after this to remain independently clickable within its corner.
    if (opts.onClick) {
      const hit = scene.add.zone(0, 0, w, h).setOrigin(0, 0);
      hit.setInteractive();
      hit.on('pointerdown', opts.onClick);
      this.add(hit);
    }

    if (opts.showFavoriteStar) {
      const starSize = Math.max(20, Math.round(h * 0.09));
      const starX = w - starSize * 0.9;
      const starY = starSize * 0.9;
      const star = mkText(scene, starX, starY, '★', starSize, line.favorite ? STAR_FILLED : STAR_EMPTY, true).setOrigin(0.5);
      this.add(star);
      const starHit = scene.add.zone(starX, starY, starSize * 1.8, starSize * 1.8).setOrigin(0.5);
      starHit.setInteractive();
      starHit.on('pointerdown', () => opts.onToggleFavorite?.());
      this.add(starHit);
    }

    scene.add.existing(this);
  }
}
