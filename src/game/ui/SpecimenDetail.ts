import Phaser from 'phaser';
import type { BreedingSpecimen } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { EXCEPTIONAL_ARCHETYPE_LABELS, STAT_LABELS } from '../systems/exceptional.ts';
import { RadarChart } from './RadarChart.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';

export interface SpecimenDetailOptions {
  /** Optional lightweight context label, e.g. "PAIRING WITH: RED BASIC" when picking the other parent. */
  pairingWithLabel?: string;
  /** CTA button text, e.g. "SELECT AS PARENT A". Omit to hide the CTA entirely. */
  ctaLabel?: string;
  onCta?: () => void;
}

/**
 * Reusable enlarged "selected Specimen" detail view — the Specimen
 * counterpart to LineDetail.ts's renderLineDetail: bigger apple image,
 * catalog rarity/number, SPECIMEN + Found Day + ONE USE reminder, a labeled
 * RadarChart, the exact five stat numbers, and an explicit CTA (the only
 * thing that commits a selection — a card click elsewhere only previews).
 * No customName/favorite/Gen — a Specimen doesn't have those.
 */
export function renderSpecimenDetail(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  specimen: BreedingSpecimen,
  opts: SpecimenDetailOptions = {},
): void {
  const appleSizePx = 180;
  const apple = new AppleVisual(scene, x + appleSizePx / 2, y + appleSizePx / 2, appleSizePx);
  apple.draw({ visualId: specimen.visualId, size: specimen.size });
  container.add(apple);

  const rarity = APPLE_RARITY[specimen.visualId];
  const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';

  const textX = x + appleSizePx + 24;
  container.add(mkText(scene, textX, y, 'SPECIMEN', 30, '#b8860b', true));
  container.add(mkText(scene, textX, y + 42, catalogLabel(specimen.visualId), 22, rarityColor, rarity !== 'COMMON', true));
  container.add(mkText(scene, textX, y + 74, `Found Day ${specimen.foundDay}`, 22, THEME.textMid, false, true));
  container.add(mkText(scene, textX, y + 106, 'ONE USE — consumed when breeding starts', 18, '#b23b3b', true));

  // Smallest useful Exceptional identification (see PROJECT.md "Exceptional
  // discovery/reveal UX") — never shown for an ordinary Visual Mutation
  // specimen, which has no exceptionalArchetype.
  let metaY = y + 138;
  if (specimen.exceptionalArchetype) {
    container.add(mkText(scene, textX, metaY, EXCEPTIONAL_ARCHETYPE_LABELS[specimen.exceptionalArchetype], 20, '#b8860b', true));
    metaY += 28;
    if (specimen.exceptionalFocusStat) {
      container.add(mkText(scene, textX, metaY, `FOCUS: ${STAT_LABELS[specimen.exceptionalFocusStat]}`, 18, THEME.textMid, false, true));
      metaY += 26;
    }
  }

  if (opts.pairingWithLabel) {
    container.add(mkText(scene, textX, metaY, opts.pairingWithLabel, 20, '#3b6db2', true));
    metaY += 28;
  }

  // The radar's own top axis label (RadarChart's showLabels, radiusFrac
  // 1.32) sits ~radius*1.32 above radarY, plus its own text height — so
  // radarY can't be a fixed offset from the apple alone, or it collides
  // with the archetype/FOCUS/pairing lines above whenever those add extra
  // height (the ELITE/TRAIT OUTLIER + FOCUS case). One shared clearance
  // constant keeps every specimen variant (with/without archetype, with/
  // without FOCUS, with/without pairing label) on the same layout path.
  const radarRadius = 108;
  const radarTopLabelClearance = radarRadius * 1.32 + 26;
  const radarY = Math.max(y + appleSizePx + 130, metaY + radarTopLabelClearance);
  const radar = new RadarChart(scene, x + w * 0.28, radarY, radarRadius, true);
  radar.setValues(specimen);
  container.add(radar);

  const statX = x + w * 0.58;
  const statRows: [string, number][] = [
    ['Sweetness', specimen.sweetness],
    ['Size', specimen.size],
    ['Yield', specimen.yieldStat],
    ['Growth', specimen.growth],
    ['Freshness', specimen.freshness],
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
