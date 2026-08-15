import Phaser from 'phaser';
import { THEME } from './theme.ts';

export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private boxW: number;
  private boxH: number;
  private enabled = true;
  private hovering = false;
  private baseColor: number;
  private onClickCb: () => void;
  private badge: Phaser.GameObjects.Arc | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void,
    color = THEME.accent,
    fontSize = 28,
    numeric = false,
  ) {
    super(scene, x, y);
    this.boxW = w;
    this.boxH = h;
    this.onClickCb = onClick;
    this.baseColor = color;

    this.bg = scene.add.graphics();
    this.add(this.bg);
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: numeric ? THEME.fontNumeric : THEME.font,
        fontSize: `${fontSize}px`,
        color: THEME.textLight,
        align: 'center',
      })
      .setOrigin(0.5);
    this.add(this.label);

    this.setSize(w, h);
    // Phaser's Container hard-codes originX/originY to 0.5 (read-only — see
    // Container.js, "Do not change this value") whenever setSize() has been
    // called, and its hit-test (InputManager.pointWithinHitArea) always adds
    // that origin as a top-left-relative offset to the incoming local point
    // before checking it against the hit area. A hitArea defined relative to
    // the button's own *center* (-w/2..w/2, matching how it's painted below)
    // then gets that offset added a second time, silently shifting the real
    // clickable rectangle a full width/height away from the visible one. The
    // fix is to define the hitArea top-left-relative (0..w, 0..h) instead —
    // matching what the forced origin already expects — rather than fighting
    // an origin Phaser won't let a Container change.
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    this.on('pointerdown', () => {
      if (this.enabled) this.onClickCb();
    });
    // Hover feedback must never change the hit-testable geometry itself
    // (size/position/scale) — only paint. A scale change here previously
    // made the hit area grow/shrink with hover state, which could flicker
    // right at a button's edge as pointerover/pointerout kept toggling it.
    this.on('pointerover', () => {
      if (!this.enabled) return;
      this.hovering = true;
      this.redraw();
    });
    this.on('pointerout', () => {
      this.hovering = false;
      this.redraw();
    });

    this.redraw();
    scene.add.existing(this);
  }

  setText(t: string): this {
    this.label.setText(t);
    return this;
  }

  setColor(color: number): this {
    this.baseColor = color;
    this.redraw();
    return this;
  }

  setEnabled(e: boolean): this {
    this.enabled = e;
    this.redraw();
    return this;
  }

  setPending(hasPending: boolean): this {
    if (hasPending && !this.badge) {
      this.badge = this.scene.add.circle(this.boxW / 2 - 12, -this.boxH / 2 + 12, 10, 0xe0392b);
      this.badge.setStrokeStyle(3, 0xffffff);
      this.add(this.badge);
    } else if (!hasPending && this.badge) {
      this.badge.destroy();
      this.badge = null;
    }
    return this;
  }

  private redraw(): void {
    this.bg.clear();
    const color = this.enabled ? this.baseColor : 0x8c8c7c;
    this.bg.fillStyle(color, 1);
    this.bg.fillRoundedRect(-this.boxW / 2, -this.boxH / 2, this.boxW, this.boxH, 16);
    if (this.hovering && this.enabled) {
      // Purely visual brightness lift — same rectangle, no geometry change.
      this.bg.fillStyle(0xffffff, 0.14);
      this.bg.fillRoundedRect(-this.boxW / 2, -this.boxH / 2, this.boxW, this.boxH, 16);
    }
    this.bg.lineStyle(3, 0x000000, 0.15);
    this.bg.strokeRoundedRect(-this.boxW / 2, -this.boxH / 2, this.boxW, this.boxH, 16);
    this.label.setAlpha(this.enabled ? 1 : 0.65);
  }
}

export class ProgressBar extends Phaser.GameObjects.Container {
  private boxW: number;
  private boxH: number;
  private bg: Phaser.GameObjects.Graphics;
  private fill: Phaser.GameObjects.Graphics;
  private fillColor: number;
  private progress = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fillColor = THEME.accent) {
    super(scene, x, y);
    this.boxW = w;
    this.boxH = h;
    this.fillColor = fillColor;
    this.bg = scene.add.graphics();
    this.fill = scene.add.graphics();
    this.add([this.bg, this.fill]);
    this.bg.fillStyle(0x000000, 0.18);
    this.bg.fillRoundedRect(0, 0, w, h, h / 2);
    this.redraw();
    scene.add.existing(this);
  }

  setProgress(p: number): this {
    this.progress = Phaser.Math.Clamp(p, 0, 1);
    this.redraw();
    return this;
  }

  setFillColor(c: number): this {
    this.fillColor = c;
    this.redraw();
    return this;
  }

  private redraw(): void {
    this.fill.clear();
    const w = Math.max(this.boxH, this.boxW * this.progress);
    if (this.progress > 0.001) {
      this.fill.fillStyle(this.fillColor, 1);
      this.fill.fillRoundedRect(0, 0, w, this.boxH, this.boxH / 2);
    }
  }
}

export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor = THEME.panelBg,
  borderColor = THEME.panelBorder,
  radius = 20,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(fillColor, 1);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(3, borderColor, 1);
  g.strokeRoundedRect(x, y, w, h, radius);
  return g;
}

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size = 26,
  color = THEME.textDark,
  bold = false,
  numeric = false,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, str, {
    fontFamily: numeric ? THEME.fontNumeric : THEME.font,
    fontSize: `${size}px`,
    color,
    fontStyle: bold ? 'bold' : 'normal',
  });
}

export function clearContainer(c: Phaser.GameObjects.Container): void {
  c.removeAll(true);
}
