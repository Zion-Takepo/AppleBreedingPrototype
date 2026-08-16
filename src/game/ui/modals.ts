import Phaser from 'phaser';
import { LAYOUT, THEME } from './theme.ts';
import { panel } from './uiKit.ts';

export interface ModalHandle {
  root: Phaser.GameObjects.Container;
  x: number;
  y: number;
  w: number;
  h: number;
  close: () => void;
}

export function createModal(scene: Phaser.Scene, w: number, h: number, panelColor = THEME.panelBg): ModalHandle {
  const root = scene.add.container(0, 0);
  root.setDepth(1000);

  const dim = scene.add.rectangle(0, 0, LAYOUT.width, LAYOUT.height, 0x000000, 0.55).setOrigin(0, 0);
  dim.setInteractive();
  root.add(dim);

  const x = (LAYOUT.width - w) / 2;
  const y = (LAYOUT.height - h) / 2;
  const bg = panel(scene, x, y, w, h, panelColor, THEME.panelBorder, 24);
  root.add(bg);

  root.setScale(0.9);
  root.setAlpha(0);
  scene.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 160, ease: 'Back.Out' });

  return {
    root,
    x,
    y,
    w,
    h,
    close: () => root.destroy(),
  };
}

interface QueuedToast {
  message: string;
  color: number;
  holdMs: number;
}

const DEFAULT_TOAST_HOLD_MS = 1800;

// Toasts are anchored from a fixed TOP boundary (just below the HUD) rather
// than a fixed center Y — a tall multi-line toast (e.g. the Exceptional
// reveal) grows its panel DOWNWARD from this line instead of growing
// symmetrically around a fixed center, which used to push its top edge
// above y=0 (clipped under/behind the HUD) for anything taller than the
// original fixed 56px single-line toast. LAYOUT.hudHeight (64) happens to
// exactly reproduce the old hardcoded y=92 center for that original 56px
// case (64 + 56/2 = 92), so ordinary single-line toasts are visually
// unchanged; only taller toasts benefit.
const TOAST_TOP_SAFE_Y = LAYOUT.hudHeight;
// Vertical slide-in/out distance for the entrance/exit tween, preserved
// exactly as before (the old tween went from y=40 to y=92, a 52px slide).
const TOAST_SLIDE_PX = 52;

// One small FIFO queue for transient toasts (see PROJECT.md "Serialize
// notifications") — every screen shares a single ToastQueue instance (see
// MainScene.create()), so queuing here is enough to guarantee at most one
// toast is ever visible at once, in trigger order, across every call site
// (breeding/trait/specimen/packing/warning/onboarding/market-hint/field/
// contest toasts alike) without touching any of them individually.
export class ToastQueue {
  private scene: Phaser.Scene;
  private queue: QueuedToast[] = [];
  private presenting = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * `message` may contain `\n` for a multi-line toast (e.g. the Exceptional
   * acquisition reveal — see systems/exceptionalReveal.ts) — width is sized
   * from the longest single line, height grows with line count, and the
   * text itself is center-aligned. `holdMs` (default 1800) lets a
   * denser/longer message like that reveal stay up long enough to actually
   * read; every other existing call site is unaffected since it just keeps
   * relying on the default.
   */
  show(message: string, color = THEME.gold, holdMs = DEFAULT_TOAST_HOLD_MS): void {
    this.queue.push({ message, color, holdMs });
    if (!this.presenting) this.presentNext();
  }

  private presentNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.presenting = false;
      return;
    }
    this.presenting = true;

    const scene = this.scene;
    const lines = next.message.split('\n');
    const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
    const lineHeight = 30;
    const w = Math.min(720, 80 + longestLine * 15);
    const h = Math.max(56, lines.length * lineHeight + 20);
    // Center derived from the toast's own rendered height so its top edge
    // always lands exactly at TOAST_TOP_SAFE_Y, never above it — see that
    // constant's doc comment.
    const targetY = TOAST_TOP_SAFE_Y + h / 2;
    const startY = targetY - TOAST_SLIDE_PX;

    const container = scene.add.container(LAYOUT.width / 2, targetY);
    container.setDepth(2000);
    const bg = panel(scene, -w / 2, -h / 2, w, h, next.color, 0x000000, 16);
    const t = scene.add
      .text(0, 0, next.message, { fontFamily: THEME.font, fontSize: '26px', color: '#1c1c14', fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5);
    container.add([bg, t]);
    container.setAlpha(0);
    container.y = startY;

    scene.tweens.add({
      targets: container,
      alpha: 1,
      y: targetY,
      duration: 220,
      ease: 'Back.Out',
      onComplete: () => {
        scene.time.delayedCall(next.holdMs, () => {
          scene.tweens.add({
            targets: container,
            alpha: 0,
            y: startY,
            duration: 220,
            onComplete: () => {
              container.destroy();
              // Next queued toast (if any) only starts its own entrance
              // once this one has fully finished — never overlapping.
              this.presentNext();
            },
          });
        });
      },
    });
  }
}
