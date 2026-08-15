import Phaser from 'phaser';
import type { AppleAssetId } from './appleAssets.ts';
import { appleTextureKey } from './appleAssets.ts';

export interface AppleDrawInput {
  visualId: AppleAssetId;
  size: number; // 0-100 genetic Size stat
}

// Visual-only scale modifier driven by genetic Size. Linear, clamped to
// 0.90x-1.10x: Size 0 -> 0.90x, Size 50 -> 1.00x, Size 100 -> 1.10x.
// This never touches genetic Size, harvest yield, or value.
export function sizeToVisualScale(size: number): number {
  const clamped = Math.max(0, Math.min(100, size));
  return 0.9 + (clamped / 100) * 0.2;
}

/**
 * Displays one of the painterly apple illustrations (see appleAssets.ts),
 * uniformly scaled down from its source resolution so aspect ratio is
 * preserved. `baseSizePx` is the on-screen size (longest edge) for a
 * genetic Size of 50; actual size nudges it by sizeToVisualScale.
 *
 * Which illustration to show (visualId) is decided by the rarity system
 * (see systems/rarity.ts) at breeding time and stored on the Variety —
 * this component just renders whichever one it's told to.
 */
export class AppleVisual extends Phaser.GameObjects.Container {
  private img: Phaser.GameObjects.Image;
  private baseSizePx: number;

  constructor(scene: Phaser.Scene, x: number, y: number, baseSizePx: number) {
    super(scene, x, y);
    this.baseSizePx = baseSizePx;
    this.img = scene.add.image(0, 0, appleTextureKey('C1'));
    this.img.setOrigin(0.5, 0.5);
    this.add(this.img);
    scene.add.existing(this);
  }

  draw(input: AppleDrawInput): void {
    this.img.setTexture(appleTextureKey(input.visualId));

    const targetPx = this.baseSizePx * sizeToVisualScale(input.size);
    const sourceLongestEdge = Math.max(this.img.width, this.img.height);
    const uniformScale = sourceLongestEdge > 0 ? targetPx / sourceLongestEdge : 1;
    this.img.setScale(uniformScale);
  }
}
