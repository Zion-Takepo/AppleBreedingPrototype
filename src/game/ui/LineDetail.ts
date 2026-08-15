import Phaser from 'phaser';
import type { Variety } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { RadarChart } from './RadarChart.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';

export interface LineDetailOptions {
  /** Optional lightweight context label, e.g. "PAIRING WITH: RED BASIC" when picking Parent B. */
  pairingWithLabel?: string;
  /** CTA button text, e.g. "SELECT AS PARENT A". Omit to hide the CTA entirely. */
  ctaLabel?: string;
  onCta?: () => void;
  onToggleFavorite?: () => void;
}

/**
 * Reusable enlarged "selected Line" detail view: bigger apple image,
 * customName, visual-variety id, rarity, Gen, a labeled RadarChart, and the
 * exact five stat numbers — plus an explicit CTA that is the ONLY thing
 * that commits a selection (clicking a card elsewhere only previews).
 * Intended for reuse by LibraryPicker now and REPLANT / a future full
 * Library screen later.
 */
export function renderLineDetail(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  line: Variety,
  opts: LineDetailOptions = {},
): void {
  const appleSizePx = 180;
  const apple = new AppleVisual(scene, x + appleSizePx / 2, y + appleSizePx / 2, appleSizePx);
  apple.draw({ visualId: line.visualId, size: line.size });
  container.add(apple);

  const rarity = APPLE_RARITY[line.visualId];
  const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';

  const textX = x + appleSizePx + 24;
  container.add(mkText(scene, textX, y, line.customName, 30, THEME.textDark, true));

  if (opts.onToggleFavorite) {
    const starColor = line.favorite ? '#c9962c' : '#a89a6a';
    // Text and hit zone are both derived from the same (starX, starY)
    // center — a centered origin on both, rather than a top-anchored
    // glyph paired with an independently-offset hit rectangle.
    const starSize = 28;
    const starX = textX + Math.min(340, w - appleSizePx - 24 - 40);
    const starY = y + 2 + starSize / 2;
    const star = mkText(scene, starX, starY, '★', starSize, starColor, true).setOrigin(0.5);
    container.add(star);
    const starHit = scene.add.zone(starX, starY, starSize * 1.8, starSize * 1.8).setOrigin(0.5);
    starHit.setInteractive();
    starHit.on('pointerdown', () => opts.onToggleFavorite?.());
    container.add(starHit);
  }

  container.add(mkText(scene, textX, y + 42, `${line.visualId}  •  ${rarity}`, 22, rarityColor, rarity !== 'COMMON', true));
  container.add(mkText(scene, textX, y + 74, `Gen ${line.generation}`, 22, THEME.textMid, false, true));

  if (opts.pairingWithLabel) {
    container.add(mkText(scene, textX, y + 108, opts.pairingWithLabel, 20, '#3b6db2', true));
  }

  const radarY = y + appleSizePx + 130;
  const radar = new RadarChart(scene, x + w * 0.28, radarY, 108, true);
  radar.setValues(line);
  container.add(radar);

  const statX = x + w * 0.58;
  const statRows: [string, number][] = [
    ['Sweetness', line.sweetness],
    ['Size', line.size],
    ['Yield', line.yieldStat],
    ['Growth', line.growth],
    ['Freshness', line.freshness],
  ];
  statRows.forEach(([label, val], i) => {
    const ry = radarY - 76 + i * 40;
    container.add(mkText(scene, statX, ry, label, 22, THEME.textMid));
    container.add(mkText(scene, statX + 180, ry, `${val}`, 22, THEME.textDark, true, true));
  });

  if (opts.ctaLabel && opts.onCta) {
    const btn = new Button(scene, x + w / 2, radarY + 150, w - 40, 64, opts.ctaLabel, opts.onCta, THEME.accent, 24);
    container.add(btn);
  }
}
