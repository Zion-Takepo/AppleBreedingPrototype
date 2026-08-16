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
}

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

  show(message: string, color = THEME.gold): void {
    this.queue.push({ message, color });
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
    const container = scene.add.container(LAYOUT.width / 2, 92);
    container.setDepth(2000);
    const w = Math.min(720, 80 + next.message.length * 15);
    const bg = panel(scene, -w / 2, -28, w, 56, next.color, 0x000000, 16);
    const t = scene.add
      .text(0, 0, next.message, { fontFamily: THEME.font, fontSize: '26px', color: '#1c1c14', fontStyle: 'bold' })
      .setOrigin(0.5);
    container.add([bg, t]);
    container.setAlpha(0);
    container.y = 40;

    scene.tweens.add({
      targets: container,
      alpha: 1,
      y: 92,
      duration: 220,
      ease: 'Back.Out',
      onComplete: () => {
        scene.time.delayedCall(1800, () => {
          scene.tweens.add({
            targets: container,
            alpha: 0,
            y: 40,
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
