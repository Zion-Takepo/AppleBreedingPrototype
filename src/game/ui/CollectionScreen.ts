import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Variety } from '../types.ts';
import { COLORS, PATTERNS } from '../tuning.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY } from '../render/appleAssets.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';

// The variety-detail illustration is one of the main rewards of opening an
// entry, so it's shown substantially larger than elsewhere.
const COLLECTION_APPLE_BASE_PX = 240;

type Tab = 'TRAITS' | 'VARIETIES';

export class CollectionScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private content: Phaser.GameObjects.Container;
  private tab: Tab = 'TRAITS';
  private selectedVarietyId: string | null = null;

  constructor(scene: Phaser.Scene, game: Game) {
    super(scene, 0, LAYOUT.contentTop);
    this.game = game;
    this.content = scene.add.container(0, 0);
    this.add(this.content);
    scene.add.existing(this);
  }

  render(): void {
    this.game.markDiscoveriesSeen();
    this.content.removeAll(true);
    this.drawTabs();
    if (this.tab === 'TRAITS') this.drawTraits();
    else this.drawVarieties();
  }

  private drawTabs(): void {
    const tabs: Tab[] = ['TRAITS', 'VARIETIES'];
    tabs.forEach((t, i) => {
      const x = 24 + i * 260;
      const active = this.tab === t;
      const btn = new Button(this.scene, x + 120, 40, 240, 56, t, () => {
        this.tab = t;
        this.render();
      }, active ? THEME.accent : 0x8a8570, 24);
      this.content.add(btn);
    });
  }

  private drawTraits(): void {
    const state = this.game.state;
    const y0 = 120;

    // OWNED vs DISCOVERED-ONLY is derived live from current Library contents
    // every render — never persisted — so it can never drift out of sync
    // with Library changes (keep/archive/etc), matching the same
    // "OWNED = derived from Library" rule MarketScreen.ts already uses for
    // visualId ownership. Color/Pattern are genetic traits (entirely
    // separate from Visual Rarity/visualId — see PROJECT.md), so ownership
    // here means "the Library currently contains at least one kept Line
    // with this Color/Pattern," not visualId ownership.
    const ownedColors = new Set(state.library.map((v) => v.color));
    const ownedPatterns = new Set(state.library.map((v) => v.pattern));

    this.content.add(panel(this.scene, 40, y0, 740, 600, THEME.panelBg, THEME.panelBorder, 20));
    this.content.add(mkText(this.scene, 72, y0 + 24, 'COLOR', 28, THEME.textDark, true));
    COLORS.forEach((c, i) => this.drawTraitRow(72, y0 + 80 + i * 60, c, state.discoveredColors.includes(c), ownedColors.has(c)));
    this.drawTraitRow(72, y0 + 80 + COLORS.length * 60, '????', false, false);

    this.content.add(panel(this.scene, 820, y0, 740, 600, THEME.panelBg, THEME.panelBorder, 20));
    this.content.add(mkText(this.scene, 852, y0 + 24, 'PATTERN', 28, THEME.textDark, true));
    PATTERNS.forEach((p, i) => this.drawTraitRow(852, y0 + 80 + i * 60, p, state.discoveredPatterns.includes(p), ownedPatterns.has(p)));
    this.drawTraitRow(852, y0 + 80 + PATTERNS.length * 60, '????', false, false);
  }

  // The check mark (✓) now unmistakably means OWNED — a kept Library Line
  // currently has this trait — never merely DISCOVERED (seen as a Breed
  // candidate, including the Day-1 Yellow / Day-5 Purple-or-Striped
  // scripted guarantees, without ever being KEPT). A DISCOVERED-but-not-
  // OWNED trait shows the distinct "SEEN" label instead of the ownership
  // check, so it can never be mistaken for ownership (see PROJECT.md
  // "DISCOVERED != OWNED"). An undiscovered trait keeps its existing '?'
  // treatment, unchanged.
  private drawTraitRow(x: number, y: number, label: string, discovered: boolean, owned: boolean): void {
    const isFuture = label === '????';
    const shown = !isFuture && discovered;
    this.content.add(mkText(this.scene, x, y, label, 26, isFuture ? THEME.textMid : THEME.textDark, shown));

    let mark: string;
    let markColor: string;
    if (!shown) {
      mark = '?';
      markColor = '#a89a6a';
    } else if (owned) {
      mark = '✓';
      markColor = '#2f5a20';
    } else {
      mark = 'SEEN';
      markColor = '#b8860b';
    }
    this.content.add(mkText(this.scene, x + 440, y, mark, mark.length > 1 ? 20 : 28, markColor, true));
  }

  private drawVarieties(): void {
    const state = this.game.state;
    const y0 = 120;
    if (!this.selectedVarietyId || !this.game.getVariety(this.selectedVarietyId)) {
      this.selectedVarietyId = state.library[state.library.length - 1]?.id ?? null;
    }

    this.content.add(panel(this.scene, 40, y0, 520, 612, THEME.panelBg, THEME.panelBorder, 20));
    const rowH = 52;
    const maxRows = Math.floor(580 / rowH);
    state.library.slice(-maxRows).forEach((v, i) => {
      const ry = y0 + 20 + i * rowH;
      const selected = v.id === this.selectedVarietyId;
      if (selected) {
        const g = this.scene.add.graphics();
        g.fillStyle(THEME.accent, 0.25);
        g.fillRoundedRect(56, ry - 6, 488, rowH - 4, 8);
        this.content.add(g);
      }
      this.content.add(mkText(this.scene, 72, ry + (rowH - 12) / 2, `${v.customName}`, 22, THEME.textDark, selected).setOrigin(0, 0.5));
      const zone = this.scene.add.zone(56, ry - 6, 488, rowH - 4).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', () => {
        this.selectedVarietyId = v.id;
        this.render();
      });
      this.content.add(zone);
    });

    const variety = this.game.getVariety(this.selectedVarietyId);
    if (variety) this.drawVarietyDetail(600, y0, variety);
  }

  private drawVarietyDetail(x: number, y0: number, v: Variety): void {
    this.content.add(panel(this.scene, x, y0, 960, 612, THEME.panelBg, THEME.panelBorder, 20));

    const apple = new AppleVisual(this.scene, x + 120, y0 + 140, COLLECTION_APPLE_BASE_PX);
    apple.draw({ visualId: v.visualId, size: v.size });
    this.content.add(apple);

    const rarity = APPLE_RARITY[v.visualId];
    const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';

    this.content.add(mkText(this.scene, x + 260, y0 + 32, v.customName, 34, THEME.textDark, true));
    this.content.add(mkText(this.scene, x + 260, y0 + 84, `Generation ${v.generation}  •  Created Day ${v.createdDay}`, 22, THEME.textMid, false, true));
    this.content.add(mkText(this.scene, x + 260, y0 + 120, `${v.color} / ${v.pattern}`, 22, THEME.textMid));
    this.content.add(mkText(this.scene, x + 260, y0 + 148, `Rarity: ${rarity}`, 22, rarityColor, rarity !== 'COMMON'));

    this.content.add(mkText(this.scene, x + 260, y0 + 208, `Sweetness  ${v.sweetness}`, 26, THEME.textDark, false, true));
    this.content.add(mkText(this.scene, x + 260, y0 + 244, `Size            ${v.size}`, 26, THEME.textDark, false, true));
    this.content.add(mkText(this.scene, x + 260, y0 + 280, `Yield           ${v.yieldStat}`, 26, THEME.textDark, false, true));

    this.content.add(mkText(this.scene, x + 32, y0 + 352, 'Awards:', 24, THEME.textDark, true));
    if (v.awards.length === 0) {
      this.content.add(mkText(this.scene, x + 32, y0 + 392, 'None yet', 22, THEME.textMid));
    } else {
      v.awards.forEach((a, i) => {
        this.content.add(mkText(this.scene, x + 32, y0 + 392 + i * 36, a, 22, THEME.textDark));
      });
    }
  }
}
