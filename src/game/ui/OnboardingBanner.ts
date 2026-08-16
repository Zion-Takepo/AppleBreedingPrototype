import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { OnboardingStep } from '../types.ts';
import type { ScreenId } from './BottomNav.ts';
import { THEME } from './theme.ts';
import { text as mkText } from './uiKit.ts';

// Compact persistent objective card (see PROJECT.md "First-session
// onboarding" section 2/13 — one reusable banner, not a blocking modal, not
// scattered text boxes). Positioned top-right, below the HUD, chosen to stay
// clear of every screen's own top-of-content elements it can appear
// alongside (Orchard field tabs sit at the top-LEFT; Breed's parent cards
// and offspring cards both start further down; the Breed "i" stat-help
// button sits further right) — see the implementation report for the exact
// clearances checked. Only shown while ORCHARD or BREED is the active
// screen — the two screens the onboarding path actually leads through; the
// underlying onboarding STATE still progresses correctly regardless of
// which screen is active (see Game.ts), this is purely a display choice to
// avoid the Calendar week-strip, which otherwise occupies this same top
// band on every other screen.
const BANNER_X = 1110;
const BANNER_Y = 68;
const BANNER_W = 372;
const BANNER_PAD_X = 14;
const BANNER_PAD_TOP = 8;
const BANNER_PAD_BOTTOM = 10;

const STEP_COPY: Partial<Record<OnboardingStep, { goal: string; support?: string }>> = {
  HARVEST_APPLE: { goal: 'Harvest a ripe apple', support: 'Harvested apples ship for cash.' },
  FIND_SPECIMEN: { goal: 'Look for the different green apple', support: 'Unusual apples can become Specimens.' },
  OPEN_BREED: { goal: 'Open BREED and use your Specimen as a parent' },
  START_BREED: { goal: 'Choose parents and start breeding', support: 'Lines are permanent. Specimens are one-use.' },
  KEEP_OFFSPRING: { goal: 'Choose one offspring to KEEP', support: 'KEEP creates a permanent Line.' },
};

export class OnboardingBanner extends Phaser.GameObjects.Container {
  private game: Game;
  private getActiveScreen: () => ScreenId;
  private bg: Phaser.GameObjects.Graphics;
  private goalText: Phaser.GameObjects.Text;
  private supportText: Phaser.GameObjects.Text;
  private skipText: Phaser.GameObjects.Text;
  private lastKey = '';

  constructor(scene: Phaser.Scene, game: Game, getActiveScreen: () => ScreenId) {
    super(scene, 0, 0);
    this.game = game;
    this.getActiveScreen = getActiveScreen;
    this.setDepth(900);

    this.bg = scene.add.graphics();
    this.add(this.bg);

    this.goalText = mkText(scene, BANNER_X + BANNER_PAD_X, BANNER_Y + BANNER_PAD_TOP, '', 16, THEME.textDark, true);
    this.goalText.setWordWrapWidth(BANNER_W - BANNER_PAD_X - 68, true);
    this.add(this.goalText);

    this.supportText = mkText(scene, BANNER_X + BANNER_PAD_X, BANNER_Y, '', 13, THEME.textMid);
    this.supportText.setWordWrapWidth(BANNER_W - BANNER_PAD_X * 2, true);
    this.add(this.supportText);

    this.skipText = mkText(scene, BANNER_X + BANNER_W - 10, BANNER_Y + 8, 'Skip Guide', 12, THEME.textMid).setOrigin(1, 0);
    this.skipText.setInteractive({ useHandCursor: true });
    this.skipText.on('pointerdown', () => this.game.skipOnboarding());
    this.add(this.skipText);

    scene.add.existing(this);
    this.refresh();
  }

  /** Called every periodic UI refresh (see MainScene.refreshAll) — cheap no-op redraw when nothing relevant changed. */
  refresh(): void {
    const ob = this.game.state.onboarding;
    const screen = this.getActiveScreen();
    const visible = !ob.dismissed && ob.step !== 'COMPLETE' && (screen === 'ORCHARD' || screen === 'BREED');
    this.setVisible(visible);
    if (!visible) return;

    const key = ob.step;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const copy = STEP_COPY[ob.step];
    if (!copy) return; // COMPLETE has no copy and is already filtered out above
    this.goalText.setText(`GOAL: ${copy.goal}`);
    this.supportText.setText(copy.support ?? '');
    this.supportText.setVisible(!!copy.support);

    this.layout(copy.support);
  }

  private layout(support: string | undefined): void {
    this.goalText.setPosition(BANNER_X + BANNER_PAD_X, BANNER_Y + BANNER_PAD_TOP);
    let cursorY = BANNER_Y + BANNER_PAD_TOP + this.goalText.height + 4;
    if (support) {
      this.supportText.setPosition(BANNER_X + BANNER_PAD_X, cursorY);
      cursorY += this.supportText.height;
    }
    const totalH = cursorY - BANNER_Y + BANNER_PAD_BOTTOM;

    this.bg.clear();
    this.bg.fillStyle(THEME.panelBg, 0.97);
    this.bg.fillRoundedRect(BANNER_X, BANNER_Y, BANNER_W, totalH, 12);
    this.bg.lineStyle(2, THEME.gold, 1);
    this.bg.strokeRoundedRect(BANNER_X, BANNER_Y, BANNER_W, totalH, 12);
  }
}
