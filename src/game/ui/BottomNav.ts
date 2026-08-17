import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { LAYOUT, ORCHARD, THEME } from './theme.ts';
import { orchardFrame, text as mkText } from './uiKit.ts';

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

// Orchard UI redesign (see PROJECT.md "Orchard UI redesign" / "BOTTOM
// NAVIGATION"): one compact, centered bar instead of a full-viewport-width
// strip, so it never crowds the far left/right edges — deliberate
// horizontal breathing room on both sides.
const BAR_W = 900;
const BAR_X = (LAYOUT.width - BAR_W) / 2;
// Styling pass (see PROJECT.md "Orchard UI Final Structure + Styling Pass"
// section 8 "BOTTOM NAV"): the visible bar sits lower and thinner within its
// existing reserved LAYOUT.navHeight band than before — this only moves the
// bar's own paint/hit-test inside that already-allocated space, it does not
// change LAYOUT.navHeight/contentBottom, so every other screen's content
// area is unaffected.
const BAR_Y = 20;
const BAR_H = 60;
const BAR_RADIUS = 16;
const TAB_W = BAR_W / TABS.length;
const TAB_INSET = 4; // active-tab highlight inset from the segment edges

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

    // Shell: one rounded deep-forest bar with a thin gold outer outline plus
    // a subtle inset inner line (see uiKit.ts orchardFrame), behind every
    // tab's own per-segment highlight graphics.
    const shell = orchardFrame(scene, BAR_X, BAR_Y, BAR_W, BAR_H, { radius: BAR_RADIUS, outerAlpha: 0.6, innerAlpha: 0.16 });
    this.add(shell);

    TABS.forEach((tab, i) => {
      const x = BAR_X + i * TAB_W;
      const g = scene.add.graphics();
      this.add(g);
      this.tabGfx.push(g);

      const label = mkText(scene, x + TAB_W / 2, BAR_Y + BAR_H / 2, tab.label, 21, ORCHARD.textWarmLight, true).setOrigin(0.5);
      this.add(label);
      this.tabLabels.push(label);

      const badge = scene.add.circle(x + TAB_W / 2 + 60, BAR_Y + BAR_H / 2 - 16, 7, 0xe0392b);
      badge.setStrokeStyle(2, 0xffffff);
      badge.setVisible(false);
      this.add(badge);
      this.badges.push(badge);

      const zone = scene.add.zone(x, BAR_Y, TAB_W, BAR_H).setOrigin(0, 0);
      zone.setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.onSelect(tab.id));
      this.add(zone);

      if (i > 0) {
        const divider = scene.add.graphics();
        divider.lineStyle(1, ORCHARD.gold, 0.25);
        divider.lineBetween(x, BAR_Y + 10, x, BAR_Y + BAR_H - 10);
        this.add(divider);
      }
    });

    // White ring around the BREED tab — added after every tab's own
    // graphics/label/zone so it always draws on top of them, but it's
    // purely a stroked outline (no fill, no interactive zone), so it never
    // changes the tab's existing hitbox/interaction area.
    const breedX = BAR_X + BREED_TAB_INDEX * TAB_W;
    this.breedRingGfx = scene.add.graphics();
    this.breedRingGfx.lineStyle(4, 0xffffff, 1);
    this.breedRingGfx.strokeRoundedRect(breedX + 4, BAR_Y + 4, TAB_W - 8, BAR_H - 8, 10);
    this.breedRingGfx.setVisible(false);
    this.add(this.breedRingGfx);

    // Pointing-hand indicator — a simple downward-pointing chevron hovering
    // just above the BREED tab (see the constant doc comment above).
    const breedCenterX = breedX + TAB_W / 2;
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
      if (isActive) {
        // Restrained highlight: an inset gold-tinted fill plus a slim gold
        // underline, rather than a loud color swap — active ORCHARD reads
        // clearly without breaking the bar's calm deep-forest read.
        const x = BAR_X + i * TAB_W;
        g.fillStyle(ORCHARD.forestMid, 1);
        g.fillRoundedRect(x + TAB_INSET, BAR_Y + TAB_INSET, TAB_W - TAB_INSET * 2, BAR_H - TAB_INSET * 2, 12);
        g.lineStyle(1.5, ORCHARD.gold, 0.5);
        g.strokeRoundedRect(x + TAB_INSET, BAR_Y + TAB_INSET, TAB_W - TAB_INSET * 2, BAR_H - TAB_INSET * 2, 12);
        g.fillStyle(THEME.gold, 1);
        g.fillRoundedRect(x + TAB_INSET + 10, BAR_Y + BAR_H - TAB_INSET - 5, TAB_W - TAB_INSET * 2 - 20, 3, 2);
      }
    });
    this.refresh();
  }
}
