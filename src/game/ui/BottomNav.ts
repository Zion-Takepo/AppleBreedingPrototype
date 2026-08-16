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

// Index of the BREED tab within TABS above — highlighted (see PROJECT.md
// "First-session onboarding" section 3) while the player's onboarding goal
// is to open it, so they notice where to go next without a blocking modal.
const BREED_TAB_INDEX = 1;

// Pointing-hand indicator (see PROJECT.md "First-session onboarding") — a
// simple minimal Phaser shape (a downward-pointing chevron), not a text/
// Unicode glyph, per the explicit "draw a shape if a glyph would be
// unreliable" guidance. Position is relative to the nav container's own
// origin (LAYOUT.contentBottom), so negative y sits just above the bar in
// the playable area, pointing down at the BREED tab. POINTER_BOB_RANGE is
// the small vertical bob amplitude — gentle, never large/flashy.
const POINTER_BASE_Y = -34;
const POINTER_BOB_RANGE = 8;

export class BottomNav extends Phaser.GameObjects.Container {
  private game: Game;
  private onSelect: (id: ScreenId) => void;
  private activeTab: ScreenId = 'ORCHARD';
  private tabGfx: Phaser.GameObjects.Graphics[] = [];
  private tabLabels: Phaser.GameObjects.Text[] = [];
  private badges: Phaser.GameObjects.Arc[] = [];
  private tabW: number;
  private breedPulseTween: Phaser.Tweens.Tween | null = null;
  // Much-stronger BREED tutorial callout (see PROJECT.md "First-session
  // onboarding" — the subtle label pulse alone was found too easy to miss):
  // a white ring around the tab plus a bobbing pointing-hand indicator,
  // both purely visual overlays that never alter the tab's own hitbox/
  // interactive zone.
  private breedRingGfx!: Phaser.GameObjects.Graphics;
  private breedPointer!: Phaser.GameObjects.Graphics;
  private breedPointerTween: Phaser.Tweens.Tween | null = null;

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

    // White ring around the BREED tab — added after every tab's own
    // graphics/label/zone so it always draws on top of them, but it's
    // purely a stroked outline (no fill, no interactive zone), so it never
    // changes the tab's existing hitbox/interaction area.
    const breedX = BREED_TAB_INDEX * this.tabW;
    this.breedRingGfx = scene.add.graphics();
    this.breedRingGfx.lineStyle(4, 0xffffff, 1);
    this.breedRingGfx.strokeRoundedRect(breedX + 4, 4, this.tabW - 8, LAYOUT.navHeight - 8, 10);
    this.breedRingGfx.setVisible(false);
    this.add(this.breedRingGfx);

    // Pointing-hand indicator — a simple downward-pointing chevron hovering
    // just above the BREED tab (see the constant doc comment above).
    const breedCenterX = breedX + this.tabW / 2;
    this.breedPointer = scene.add.graphics();
    this.breedPointer.setPosition(breedCenterX, POINTER_BASE_Y);
    this.breedPointer.fillStyle(0xffffff, 1);
    this.breedPointer.fillTriangle(-14, -22, 14, -22, 0, 0);
    this.breedPointer.lineStyle(3, 0x1c1c14, 0.6);
    this.breedPointer.strokeTriangle(-14, -22, 14, -22, 0, 0);
    this.breedPointer.setVisible(false);
    this.add(this.breedPointer);

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
    this.updateBreedCallout();
  }

  // BREED tutorial callout (see PROJECT.md "First-session onboarding") —
  // active only while the player's current onboarding goal is exactly
  // OPEN_BREED; stops immediately the instant that's no longer true (BREED
  // opened and the goal advances, guide skipped, or onboarding already
  // complete). Three layered pieces, all gated on the same condition:
  //  1. the original subtle, non-obnoxious label pulse (kept — harmless and
  //     additive, see PROJECT.md's "no obnoxious flashing" exclusion);
  //  2. a much more obvious white ring around the whole tab;
  //  3. a bobbing pointing-hand (chevron) indicator above it.
  // None of these ever alter the tab's normal styling once this step ends,
  // and none touch the existing interactive zone/hitbox.
  private updateBreedCallout(): void {
    const ob = this.game.state.onboarding;
    const shouldHighlight = !ob.dismissed && ob.step === 'OPEN_BREED';
    const label = this.tabLabels[BREED_TAB_INDEX];

    if (shouldHighlight && !this.breedPulseTween) {
      this.breedPulseTween = this.scene.tweens.add({
        targets: label,
        alpha: 0.45,
        duration: 550,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else if (!shouldHighlight && this.breedPulseTween) {
      this.breedPulseTween.stop();
      this.breedPulseTween = null;
      label.setAlpha(1);
    }

    this.breedRingGfx.setVisible(shouldHighlight);
    this.breedPointer.setVisible(shouldHighlight);
    if (shouldHighlight && !this.breedPointerTween) {
      this.breedPointer.y = POINTER_BASE_Y;
      this.breedPointerTween = this.scene.tweens.add({
        targets: this.breedPointer,
        y: POINTER_BASE_Y + POINTER_BOB_RANGE,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else if (!shouldHighlight && this.breedPointerTween) {
      this.breedPointerTween.stop();
      this.breedPointerTween = null;
      this.breedPointer.y = POINTER_BASE_Y;
    }
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
