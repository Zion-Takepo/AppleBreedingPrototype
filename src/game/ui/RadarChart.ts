import Phaser from 'phaser';
import { THEME } from './theme.ts';

export interface RadarValues {
  sweetness: number;
  size: number;
  yieldStat: number;
  growth: number;
  freshness: number;
}

// Fixed, stable axis order — mirrors the order these five traits are
// discussed everywhere else (PROJECT.md, breeding.ts's Stats5 tuples).
const AXIS_ORDER: (keyof RadarValues)[] = ['sweetness', 'size', 'yieldStat', 'growth', 'freshness'];
const AXIS_LABELS = ['Sweetness', 'Size', 'Yield', 'Growth', 'Freshness'];
const AXIS_COUNT = 5;

function axisPoint(index: number, radiusFrac: number, radius: number): { x: number; y: number } {
  // Index 0 (Sweetness) at the top, then clockwise.
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / AXIS_COUNT;
  return { x: Math.cos(angle) * radius * radiusFrac, y: Math.sin(angle) * radius * radiusFrac };
}

/**
 * Reusable 5-axis (Sweetness/Size/Yield/Growth/Freshness) radar/pentagon
 * chart. Purely a rendering component — callers pass in the five 0..100
 * genetic values via setValues(); this never reads game state itself, so
 * it's safe to reuse anywhere a Variety's genetic profile needs a compact
 * visual comparison (Breed candidates now; Library/Collection cards in a
 * later pass). No numeric total/score is ever drawn — shape only.
 */
export class RadarChart extends Phaser.GameObjects.Container {
  private radius: number;
  private gridGfx: Phaser.GameObjects.Graphics;
  private shapeGfx: Phaser.GameObjects.Graphics;

  /** @param showLabels Draws the five axis-name labels around the chart. Defaults to true (unchanged from the original single-use-case behavior) — pass false for compact/mini uses (e.g. Library picker grid cards) where full labels would overwhelm a small chart. */
  constructor(scene: Phaser.Scene, x: number, y: number, radius = 78, showLabels = true) {
    super(scene, x, y);
    this.radius = radius;

    this.gridGfx = scene.add.graphics();
    this.shapeGfx = scene.add.graphics();
    this.add([this.gridGfx, this.shapeGfx]);

    if (showLabels) {
      AXIS_LABELS.forEach((label, i) => {
        const p = axisPoint(i, 1.32, this.radius);
        const t = scene.add
          .text(p.x, p.y, label, { fontFamily: THEME.font, fontSize: '16px', color: THEME.textMid })
          .setOrigin(0.5);
        this.add(t);
      });
    }

    this.drawGrid();
    scene.add.existing(this);
  }

  private drawGrid(): void {
    this.gridGfx.clear();
    const rings = [0.33, 0.66, 1.0];
    rings.forEach((frac) => {
      this.gridGfx.lineStyle(1, 0x9c9484, frac === 1 ? 0.7 : 0.4);
      const pts = Array.from({ length: AXIS_COUNT }, (_, i) => axisPoint(i, frac, this.radius));
      this.gridGfx.beginPath();
      pts.forEach((p, i) => (i === 0 ? this.gridGfx.moveTo(p.x, p.y) : this.gridGfx.lineTo(p.x, p.y)));
      this.gridGfx.closePath();
      this.gridGfx.strokePath();
    });
    this.gridGfx.lineStyle(1, 0x9c9484, 0.4);
    for (let i = 0; i < AXIS_COUNT; i++) {
      const p = axisPoint(i, 1.0, this.radius);
      this.gridGfx.lineBetween(0, 0, p.x, p.y);
    }
  }

  /** Draws (or redraws) the value polygon. Values are clamped to 0..100 defensively. */
  setValues(values: RadarValues, color = THEME.accentDark): void {
    this.shapeGfx.clear();
    const pts = AXIS_ORDER.map((key, i) => {
      const v = Math.max(0, Math.min(100, values[key]));
      return axisPoint(i, v / 100, this.radius);
    });

    this.shapeGfx.fillStyle(color, 0.32);
    this.shapeGfx.lineStyle(2.5, color, 0.95);
    this.shapeGfx.beginPath();
    pts.forEach((p, i) => (i === 0 ? this.shapeGfx.moveTo(p.x, p.y) : this.shapeGfx.lineTo(p.x, p.y)));
    this.shapeGfx.closePath();
    this.shapeGfx.strokePath();
    this.shapeGfx.fillPath();

    this.shapeGfx.fillStyle(color, 1);
    pts.forEach((p) => this.shapeGfx.fillCircle(p.x, p.y, 3));
  }
}
