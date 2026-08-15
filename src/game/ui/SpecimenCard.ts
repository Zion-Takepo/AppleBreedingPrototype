import Phaser from 'phaser';
import type { BreedingSpecimen } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { RadarChart } from './RadarChart.ts';
import { THEME } from './theme.ts';
import { panel, text as mkText } from './uiKit.ts';

export interface SpecimenCardOptions {
  /** Apple illustration size in px. Defaults to a fraction of card height. */
  appleSizePx?: number;
  /** Mini radar radius in px. Defaults to a fraction of card height. */
  radarRadius?: number;
  /** Whether the radar draws its axis labels — off by default for compact grid use, on for large parent/detail use. */
  radarLabels?: boolean;
  /** Highlights the card as the currently previewed/selected one. */
  selected?: boolean;
  /** Whole-card click (select/preview) — never mutates anything itself. */
  onClick?: () => void;
}

/**
 * Reusable card for one held Breeding Specimen: apple image, catalog
 * rarity/number, a SPECIMEN badge, Found Day, a ONE USE reminder, and a
 * mini RadarChart — the Specimen counterpart to LineCard.ts, deliberately
 * simpler (no customName, no favorite star, no Gen — a Specimen has none of
 * those; see types.ts's BreedingSpecimen doc comment). Used by both
 * LibraryPicker's SPECIMENS grid and BreedScreen's large Parent A/B slots.
 */
export class SpecimenCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, specimen: BreedingSpecimen, opts: SpecimenCardOptions = {}) {
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
    apple.draw({ visualId: specimen.visualId, size: specimen.size });
    this.add(apple);

    const rarity = APPLE_RARITY[specimen.visualId];
    const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';
    this.add(mkText(scene, 10, 10, catalogLabel(specimen.visualId), 13, rarityColor, rarity !== 'COMMON', true));
    this.add(mkText(scene, w - 10, 10, 'SPECIMEN', 12, '#b8860b', true, true).setOrigin(1, 0));

    const rowSize = 16;
    let ty = appleSizePx + 22;
    this.add(mkText(scene, w / 2, ty, `Found Day ${specimen.foundDay}`, rowSize, THEME.textDark, true).setOrigin(0.5, 0));
    ty += rowSize + 6;
    this.add(mkText(scene, w / 2, ty, 'ONE USE', 14, '#b23b3b', true, true).setOrigin(0.5, 0));
    ty += 14 + (radarLabels ? 34 : 10);

    const radar = new RadarChart(scene, w / 2, ty + radarRadius, radarRadius, radarLabels);
    radar.setValues(specimen);
    this.add(radar);

    if (opts.onClick) {
      const hit = scene.add.zone(0, 0, w, h).setOrigin(0, 0);
      hit.setInteractive();
      hit.on('pointerdown', opts.onClick);
      this.add(hit);
    }

    scene.add.existing(this);
  }
}
