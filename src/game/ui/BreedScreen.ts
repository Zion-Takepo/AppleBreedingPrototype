import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { BreedParentRef, OffspringCandidate, Variety } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { LAYOUT, THEME } from './theme.ts';
import { Button, ProgressBar, panel, text as mkText } from './uiKit.ts';
import { RadarChart } from './RadarChart.ts';
import { LineCard } from './LineCard.ts';
import { SpecimenCard } from './SpecimenCard.ts';
import { openLibraryPicker } from './LibraryPicker.ts';
import { ToastQueue } from './modals.ts';
import { createStatInfoButton } from './StatHelpModal.ts';

// Shared top-right placement for the "i" stat-info button on both Breed
// screens (parent selection and offspring result) — see PROJECT.md
// "Five-stat info button". Kept just below the TIME PAUSED indicator's own
// corner so neither overlaps.
const INFO_BUTTON_X = LAYOUT.width - 50;
const INFO_BUTTON_Y = 60;

// Large Parent A/B card height — tall enough for apple + name/visual-
// variety/Gen text + a small radar without overlap (see LineCard's
// top-down flow layout).
const PARENT_CARD_H = 380;

type Slot = 'A' | 'B' | 'C' | 'D';
const SLOTS: Slot[] = ['A', 'B', 'C', 'D'];
const SLOT_ROLE_LABEL: Record<Slot, string> = {
  A: 'PARENT A TYPE',
  B: 'PARENT B TYPE',
  C: 'RECOMBINED',
  D: 'WILDCARD',
};

// The five genetic traits, in the same fixed order used everywhere else
// (RadarChart's AXIS_ORDER, breeding.ts's Stats5 tuples).
const TRAIT_KEYS: (keyof Pick<Variety, 'sweetness' | 'size' | 'yieldStat' | 'growth' | 'freshness'>)[] = [
  'sweetness',
  'size',
  'yieldStat',
  'growth',
  'freshness',
];
const TRAIT_LABELS: Record<string, string> = {
  sweetness: 'Sweetness',
  size: 'Size',
  yieldStat: 'Yield',
  growth: 'Growth',
  freshness: 'Freshness',
};

interface PostKeepResult {
  line: Variety;
  newDiscovery: boolean;
  firstOwned: boolean;
}

function formatDelta(delta: number): { text: string; color: string } {
  const rounded = Math.round(delta);
  if (rounded === 0) return { text: '•0', color: THEME.textMid };
  if (rounded > 0) return { text: `▲+${rounded}`, color: '#2f5a20' };
  return { text: `▼${rounded}`, color: '#b23b3b' };
}

export class BreedScreen extends Phaser.GameObjects.Container {
  private game: Game;
  private toasts: ToastQueue;
  private content: Phaser.GameObjects.Container;
  private selectedA: BreedParentRef | null = null;
  private selectedB: BreedParentRef | null = null;
  // Which of the 4 candidates is currently previewed on the result screen —
  // clicking a card only ever sets this; only the KEEP button commits.
  private selectedSlot: Slot | null = null;
  private keepInProgress = false;
  private postKeepResult: PostKeepResult | null = null;
  private renamingActive = false;
  private renameInputEl: HTMLInputElement | null = null;

  constructor(scene: Phaser.Scene, game: Game, toasts: ToastQueue) {
    super(scene, 0, LAYOUT.contentTop);
    this.game = game;
    this.toasts = toasts;
    this.content = scene.add.container(0, 0);
    this.add(this.content);
    scene.add.existing(this);
  }

  /** Verification-only: not used by any gameplay path. */
  debugSelectedSlot(): Slot | null {
    return this.selectedSlot;
  }

  // Navigating to another bottom-nav tab must not leave a floating DOM
  // rename input stuck over the canvas — Phaser hiding this Container
  // doesn't touch DOM elements outside its own display list.
  setVisible(value: boolean): this {
    if (!value) {
      this.renamingActive = false;
      this.destroyRenameInput();
    }
    return super.setVisible(value);
  }

  render(): void {
    // MainScene's periodic refresh calls render() every ~120ms regardless
    // of screen — while the rename DOM input is open, that must NOT tear
    // it down (it would blow away whatever the player is mid-typing), so
    // only clean it up here when we're not in the middle of a rename.
    if (!this.renamingActive) this.destroyRenameInput();
    this.content.removeAll(true);
    const breeding = this.game.state.breeding;

    if (this.postKeepResult) {
      this.renderPostKeep(this.postKeepResult);
    } else if (breeding.ready && breeding.offspring) {
      this.renderOffspringComparison(breeding.offspring);
    } else if (breeding.active) {
      this.renderInProgress();
    } else {
      this.renderSelectParents();
    }

    this.renderTimePausedIndicator();
  }

  /**
   * Subtle, secondary reminder that the simulation is frozen while Breed is
   * the active screen (see PROJECT.md "Breed is a strategic pause" — the
   * actual pause gate lives in MainScene.update(), not here; this is just
   * the player-facing indicator). Omitted during the rare edge case where
   * Closing is already in progress or the day has already ended, since the
   * simulation genuinely isn't paused then (see MainScene.isBreedPauseActive).
   */
  private renderTimePausedIndicator(): void {
    if (this.game.state.closing || this.game.state.dayEnded) return;
    this.content.add(mkText(this.scene, LAYOUT.width - 16, 8, 'TIME PAUSED', 16, THEME.textMid, false, true).setOrigin(1, 0));
  }

  private renderStatInfoButton(): void {
    const btn = createStatInfoButton(this.scene, INFO_BUTTON_X, INFO_BUTTON_Y);
    this.content.add(btn);
  }

  /**
   * "TOTAL 267 -> 272 (+5)" (see PROJECT.md section 3) — the comparison
   * baseline is always the STRONGER parent's TOTAL (the guaranteed
   * progression rule), and the target is the single shared TOTAL every one
   * of the four candidates was rescaled to, so this is identical no matter
   * which candidate card it's drawn on. Null only for a pre-this-pass
   * reloaded result (old save, no persisted TOTAL data) — omitted rather
   * than showing a bogus number.
   */
  private formatTotalLine(): string | null {
    const { strongerParentTotal, breedTargetTotal } = this.game.state.breeding;
    if (strongerParentTotal === null || breedTargetTotal === null) return null;
    const delta = breedTargetTotal - strongerParentTotal;
    const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
    return `TOTAL ${strongerParentTotal} → ${breedTargetTotal} (${deltaText})`;
  }

  private renderSelectParents(): void {
    this.content.add(mkText(this.scene, 24, 12, 'BREED — choose two parents', 30, THEME.textDark, true));
    this.renderStatInfoButton();

    this.drawParentCard(100, 70, 'A', this.selectedA, (ref) => {
      this.selectedA = ref;
      this.render();
    });
    this.drawParentCard(900, 70, 'B', this.selectedB, (ref) => {
      this.selectedB = ref;
      this.render();
    });

    // Swap control — matters because offspring A is Parent-A-biased and
    // offspring B is Parent-B-biased, so which side a parent sits on
    // changes the outcome distribution, not just cosmetically.
    const swapBtn = new Button(this.scene, LAYOUT.width / 2, 70 + 34 + PARENT_CARD_H / 2, 76, 76, '⇄', () => this.swapParents(), THEME.info, 32);
    this.content.add(swapBtn);

    // The same Specimen id can't occupy both slots — the picker already
    // excludes it from the OTHER slot's list, but this is the
    // defense-in-depth "clearly disable BREED" half of that rule (see
    // PROJECT.md section 9).
    const sameSpecimenConflict =
      !!this.selectedA && !!this.selectedB && this.selectedA.kind === 'SPECIMEN' && this.selectedB.kind === 'SPECIMEN' && this.selectedA.id === this.selectedB.id;

    const cost = this.game.breedingCost();
    const duration = this.game.breedingDuration();
    const canStart = this.game.canStartBreeding() && !!this.selectedA && !!this.selectedB && !sameSpecimenConflict && this.game.state.cash >= cost;

    const breedBtnY = 70 + 34 + PARENT_CARD_H + 50;
    const costLabel = cost === 0 ? 'FREE' : `$${cost}`;
    const btn = new Button(
      this.scene,
      LAYOUT.width / 2,
      breedBtnY,
      520,
      88,
      `BREED  (${costLabel}, ~${duration}s)`,
      () => this.startBreeding(),
      THEME.accent,
      30,
      true,
    );
    btn.setEnabled(canStart);
    this.content.add(btn);

    // One dedicated status line below BREED — never two messages stacked
    // on the same coordinates. Unavailability takes priority over the tip
    // (they can both be true at once, e.g. first-ever-breeding attempted
    // outside the active day) since it's the more actionable message.
    let statusText = '';
    let statusColor = THEME.textMid;
    let statusBold = false;
    if (!this.game.canStartBreeding()) {
      statusText = 'Breeding is only available while the day is active.';
      statusColor = '#b23b3b';
      statusBold = true;
    } else if (!this.game.state.breeding.everBredOnce) {
      statusText = 'Tip: try RED BASIC + GREEN BASIC for your first cross!';
    }
    if (statusText) {
      this.content.add(mkText(this.scene, LAYOUT.width / 2, breedBtnY + 100, statusText, 22, statusColor, statusBold).setOrigin(0.5, 0));
    }
  }

  private swapParents(): void {
    const tmp = this.selectedA;
    this.selectedA = this.selectedB;
    this.selectedB = tmp;
    this.render();
  }

  private parentDisplayName(ref: BreedParentRef | null): string | undefined {
    if (!ref) return undefined;
    if (ref.kind === 'LINE') return this.game.getVariety(ref.id)?.customName;
    const specimen = this.game.state.specimens.find((s) => s.id === ref.id);
    return specimen ? `${catalogLabel(specimen.visualId)} SPECIMEN` : undefined;
  }

  // Large Parent A/B card. Per spec, shows only apple/name-or-catalog-
  // label/rarity/Gen (Lines) or catalog label/Found Day (Specimens)/mini
  // RadarChart — never the exact five stat numbers here (that's what the
  // Library Picker's detail panel is for). Clicking anywhere on the card
  // (filled or empty) opens the Library Picker in the matching "SELECT
  // PARENT A/B" mode, defaulted to whichever source the current selection
  // is from; only that picker's explicit CTA actually commits a selection.
  private drawParentCard(x: number, y: number, label: 'A' | 'B', ref: BreedParentRef | null, onPick: (ref: BreedParentRef) => void): void {
    const w = 560;
    const h = PARENT_CARD_H;
    this.content.add(mkText(this.scene, x, y, `Parent ${label}`, 22, THEME.textMid, true));

    const openPicker = () => {
      const otherRef = label === 'A' ? this.selectedB : this.selectedA;
      const otherName = this.parentDisplayName(otherRef);
      openLibraryPicker(this.scene, this.game, {
        title: `SELECT PARENT ${label}`,
        ctaLabel: `SELECT AS PARENT ${label}`,
        pairingWithLabel: otherName ? `PAIRING WITH: ${otherName}` : undefined,
        excludeSpecimenId: otherRef?.kind === 'SPECIMEN' ? otherRef.id : null,
        initialSourceMode: ref?.kind === 'SPECIMEN' ? 'SPECIMENS' : 'LINES',
        onSelect: (pickedRef) => onPick(pickedRef),
      });
    };

    const variety = ref?.kind === 'LINE' ? this.game.getVariety(ref.id) : undefined;
    const specimen = ref?.kind === 'SPECIMEN' ? this.game.state.specimens.find((s) => s.id === ref.id) : undefined;

    if (variety) {
      const card = new LineCard(this.scene, x, y + 34, w, h, variety, {
        appleSizePx: 150,
        radarRadius: 68,
        radarLabels: false,
        onClick: openPicker,
      });
      this.content.add(card);
    } else if (specimen) {
      const card = new SpecimenCard(this.scene, x, y + 34, w, h, specimen, {
        appleSizePx: 150,
        radarRadius: 68,
        radarLabels: false,
        onClick: openPicker,
      });
      this.content.add(card);
    } else {
      const bg = panel(this.scene, x, y + 34, w, h, THEME.panelBg2, THEME.panelBorder, 14);
      this.content.add(bg);
      this.content.add(mkText(this.scene, x + w / 2, y + 34 + h / 2 - 16, 'No parent selected', 24, THEME.textMid).setOrigin(0.5));
      this.content.add(mkText(this.scene, x + w / 2, y + 34 + h / 2 + 18, 'Click to choose a Line or Specimen', 18, THEME.textMid).setOrigin(0.5));
      const zone = this.scene.add.zone(x, y + 34, w, h).setOrigin(0, 0);
      zone.setInteractive();
      zone.on('pointerdown', openPicker);
      this.content.add(zone);
    }
  }

  private startBreeding(): void {
    if (!this.selectedA || !this.selectedB) return;
    const ok = this.game.startBreeding(this.selectedA, this.selectedB);
    if (ok) {
      this.selectedA = null;
      this.selectedB = null;
      this.selectedSlot = null;
      this.toasts.show('Breeding started! Check back soon.', THEME.accent);
      this.render();
    } else {
      this.toasts.show('Cannot start breeding right now.', THEME.danger);
    }
  }

  private renderInProgress(): void {
    const breeding = this.game.state.breeding;
    const parentA = this.game.getVariety(breeding.parentAId);
    const parentB = this.game.getVariety(breeding.parentBId);

    this.content.add(mkText(this.scene, LAYOUT.width / 2, 40, 'BREEDING IN PROGRESS', 32, THEME.textDark, true).setOrigin(0.5, 0));
    this.content.add(
      mkText(this.scene, LAYOUT.width / 2, 100, `${parentA?.customName ?? '?'}  ×  ${parentB?.customName ?? '?'}`, 26, THEME.textMid).setOrigin(0.5, 0),
    );

    const bar = new ProgressBar(this.scene, LAYOUT.width / 2 - 300, 200, 600, 32, THEME.accent);
    bar.setProgress(breeding.elapsed / breeding.duration);
    this.content.add(bar);

    const remaining = Math.max(0, Math.ceil(breeding.duration - breeding.elapsed));
    this.content.add(mkText(this.scene, LAYOUT.width / 2, 252, `${remaining}s remaining`, 24, THEME.textMid, false, true).setOrigin(0.5, 0));

    this.content.add(
      mkText(
        this.scene,
        LAYOUT.width / 2,
        340,
        "Farm time is paused while you're on this tab, but breeding still\nbrews normally — feel free to wait here, or check the Orchard,\nCalendar, or Collection instead.",
        24,
        THEME.textMid,
        false,
      )
        .setOrigin(0.5, 0)
        .setAlign('center'),
    );
  }

  // ------------------------------------------------------------------
  // Four-candidate result screen
  // ------------------------------------------------------------------

  private renderOffspringComparison(offspring: OffspringCandidate[]): void {
    const breeding = this.game.state.breeding;
    const parentA = this.game.getVariety(breeding.parentAId);
    const parentB = this.game.getVariety(breeding.parentBId);

    this.content.add(
      mkText(this.scene, LAYOUT.width / 2, 10, 'BREEDING RESULT — select a candidate to inspect', 26, THEME.textDark, true).setOrigin(0.5, 0),
    );
    this.renderStatInfoButton();

    const cardW = 360;
    // A few px taller than the original 480 to fit the new TOTAL
    // progression line (see PROJECT.md section 3) without cramping the
    // existing Gen/radar layout.
    const cardH = 496;
    const gap = 20;
    const startX = (LAYOUT.width - (cardW * 4 + gap * 3)) / 2;
    // Nudged down from the original 56 for a bit more breathing room under
    // the title/info-button row above (see the Breed-result layout tweak).
    const startY = 76;

    // Discovery already happened at breed-resolve time (Game.resolveBreeding
    // adds newly-seen visualIds to discoveredVisualIds right away, before
    // this screen can ever be shown) — `child.isNewVisualId` on each frozen
    // offspring candidate IS the "newly discovered by this result" record,
    // so there's nothing further to compute or persist here.
    SLOTS.forEach((slot, i) => {
      const child = offspring.find((o) => o.slot === slot);
      if (!child) return;
      const x = startX + i * (cardW + gap);
      this.drawCandidateCard(x, startY, cardW, cardH, child, child.slot === this.selectedSlot, () => {
        this.selectedSlot = child.slot;
        this.render();
      });
    });

    this.drawSelectionDetail(offspring, parentA, parentB, startY + cardH + 16);
  }

  private drawCandidateCard(x: number, y: number, w: number, h: number, child: OffspringCandidate, selected: boolean, onClick: () => void): void {
    const borderColor = selected ? THEME.accent : THEME.panelBorder;
    const bg = panel(this.scene, x, y, w, h, THEME.panelBg2, borderColor, 16);
    if (selected) {
      bg.lineStyle(4, THEME.accent, 1);
      bg.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 15);
    }
    this.content.add(bg);

    const rarity = APPLE_RARITY[child.visualId];
    const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';
    this.content.add(mkText(this.scene, x + 10, y + 8, catalogLabel(child.visualId), 13, rarityColor, rarity !== 'COMMON', true));

    let ty = y + 14;
    this.content.add(mkText(this.scene, x + w / 2, ty, child.slot, 32, THEME.textDark, true).setOrigin(0.5, 0));
    ty += 38;
    this.content.add(mkText(this.scene, x + w / 2, ty, SLOT_ROLE_LABEL[child.slot], 15, THEME.textMid, false, true).setOrigin(0.5, 0));
    ty += 31;

    const appleSize = 140;
    const apple = new AppleVisual(this.scene, x + w / 2, ty + appleSize / 2, appleSize);
    apple.draw({ visualId: child.visualId, size: child.size });
    this.content.add(apple);
    ty += appleSize + 14;

    this.content.add(mkText(this.scene, x + w / 2, ty, `Gen ${child.generation}`, 17, THEME.textMid, false, true).setOrigin(0.5, 0));
    ty += 26;

    // TOTAL progression (see PROJECT.md section 2/3) — every Breed
    // operation rescales all four candidates to the SAME shared target
    // TOTAL, so this line is identical across all four cards; kept
    // visually secondary (small, muted) to the candidate's main stats/
    // Visual above and below it.
    const totalLine = this.formatTotalLine();
    if (totalLine) {
      this.content.add(mkText(this.scene, x + w / 2, ty, totalLine, 15, THEME.textMid, false, true).setOrigin(0.5, 0));
      ty += 24;
    }
    ty += 22; // gap before the radar (matches LineCard's labeled-radar convention)

    const radarRadius = 76;
    const radar = new RadarChart(this.scene, x + w / 2, ty + radarRadius, radarRadius, true);
    radar.setValues(child);
    this.content.add(radar);

    // Whole-card click = select/preview only — never commits a KEEP.
    const hit = this.scene.add.zone(x, y, w, h).setOrigin(0, 0);
    hit.setInteractive();
    hit.on('pointerdown', onClick);
    this.content.add(hit);
  }

  private drawSelectionDetail(offspring: OffspringCandidate[], parentA: Variety | undefined, parentB: Variety | undefined, y: number): void {
    const chosen = this.selectedSlot ? offspring.find((o) => o.slot === this.selectedSlot) : undefined;
    const warning = this.rareEpicUnownedWarning(offspring, chosen?.visualId ?? null);

    if (!chosen) {
      this.content.add(mkText(this.scene, LAYOUT.width / 2, y, 'Select a candidate above to inspect it.', 22, THEME.textMid).setOrigin(0.5, 0));
      if (warning) {
        this.content.add(mkText(this.scene, LAYOUT.width / 2, y + 36, warning, 18, '#8a6d1a').setOrigin(0.5, 0).setAlign('center'));
      }
      return;
    }

    // Exact numbers + delta-from-parent-genetic-average — only for the
    // selected candidate, and only genetic values (never cultivation-
    // adjusted effective stats, which don't apply to an unplanted Line).
    const colW = (LAYOUT.width - 100) / TRAIT_KEYS.length;
    TRAIT_KEYS.forEach((key, i) => {
      const cx = 50 + colW * i + colW / 2;
      const pa = parentA ? parentA[key] : 0;
      const pb = parentB ? parentB[key] : 0;
      const parentAverage = (pa + pb) / 2;
      const delta = chosen[key] - parentAverage;
      const { text: deltaText, color: deltaColor } = formatDelta(delta);

      this.content.add(mkText(this.scene, cx, y, TRAIT_LABELS[key], 17, THEME.textMid).setOrigin(0.5, 0));
      this.content.add(mkText(this.scene, cx, y + 22, `${chosen[key]}`, 24, THEME.textDark, true, true).setOrigin(0.5, 0));
      this.content.add(mkText(this.scene, cx, y + 50, deltaText, 18, deltaColor, true, true).setOrigin(0.5, 0));
    });

    let nextY = y + 80;
    if (warning) {
      this.content.add(mkText(this.scene, LAYOUT.width / 2, nextY, warning, 18, '#8a6d1a').setOrigin(0.5, 0).setAlign('center'));
    }
    nextY += 40;

    const keepBtn = new Button(this.scene, LAYOUT.width / 2, nextY, 280, 64, `KEEP ${chosen.slot}`, () => this.handleKeep(), THEME.accent, 26);
    this.content.add(keepBtn);
  }

  /**
   * Non-blocking heads-up: a Rare/Epic visual appeared in this result,
   * isn't owned yet, and won't become owned unless the currently-selected
   * candidate (which carries that exact visualId) is the one kept. Never
   * fires for Common, never fires for an already-owned visual, and never
   * blocks or discourages picking a genetically stronger Common instead —
   * it's informational only.
   */
  private rareEpicUnownedWarning(offspring: OffspringCandidate[], selectedVisualId: string | null): string | null {
    const qualifying = offspring.filter((o) => {
      if (APPLE_RARITY[o.visualId] === 'COMMON') return false;
      if (this.game.isVisualIdOwned(o.visualId)) return false;
      if (o.visualId === selectedVisualId) return false;
      return true;
    });
    const uniqueIds = [...new Set(qualifying.map((o) => o.visualId))];
    if (uniqueIds.length === 0) return null;
    if (uniqueIds.length === 1) {
      return `${catalogLabel(uniqueIds[0])} is discovered, but you won't own it unless you KEEP that candidate.`;
    }
    return `${uniqueIds.map(catalogLabel).join(', ')} are discovered, but won't be owned unless kept.`;
  }

  private handleKeep(): void {
    if (this.keepInProgress || !this.selectedSlot) return;
    const breeding = this.game.state.breeding;
    if (!breeding.ready || !breeding.offspring) return;
    const chosen = breeding.offspring.find((o) => o.slot === this.selectedSlot);
    if (!chosen) return;

    this.keepInProgress = true;
    // Must be captured BEFORE Game.keepOffspring() actually inserts the
    // Line — otherwise "was it already owned" would trivially always be
    // true (it'd own itself).
    const wasOwnedBefore = this.game.isVisualIdOwned(chosen.visualId);
    const line = this.game.keepOffspring(this.selectedSlot);
    this.keepInProgress = false;
    if (!line) return; // already consumed by a prior call — no-op, no duplicate Line

    this.postKeepResult = {
      line,
      newDiscovery: chosen.isNewVisualId,
      firstOwned: !wasOwnedBefore,
    };
    this.selectedSlot = null;
    this.render();
  }

  // ------------------------------------------------------------------
  // Post-KEEP screen
  // ------------------------------------------------------------------

  private renderPostKeep(result: PostKeepResult): void {
    const { line } = result;
    const rarity = APPLE_RARITY[line.visualId];
    const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';
    const cx = LAYOUT.width / 2;

    this.content.add(mkText(this.scene, cx, 40, 'KEPT!', 40, '#2f5a20', true).setOrigin(0.5, 0));

    const appleSize = 220;
    const apple = new AppleVisual(this.scene, cx, 220, appleSize);
    apple.draw({ visualId: line.visualId, size: line.size });
    this.content.add(apple);

    let ty = 350;
    this.content.add(mkText(this.scene, cx, ty, line.customName, 32, THEME.textDark, true).setOrigin(0.5, 0));
    ty += 44;
    this.content.add(mkText(this.scene, cx, ty, catalogLabel(line.visualId), 20, rarityColor, rarity !== 'COMMON', true).setOrigin(0.5, 0));
    ty += 30;
    this.content.add(mkText(this.scene, cx, ty, `Gen ${line.generation}`, 20, THEME.textMid, false, true).setOrigin(0.5, 0));
    ty += 40;
    this.content.add(mkText(this.scene, cx, ty, 'ADDED TO LIBRARY', 22, '#2f5a20', true).setOrigin(0.5, 0));
    ty += 44;

    const badges: string[] = [];
    if (result.newDiscovery) badges.push('NEW DISCOVERY');
    if (result.firstOwned) badges.push('FIRST OWNED');
    if (badges.length > 0) {
      const badgeW = 220;
      const totalW = badges.length * badgeW + (badges.length - 1) * 16;
      let bx = cx - totalW / 2;
      badges.forEach((label) => {
        const badge = panel(this.scene, bx, ty, badgeW, 40, THEME.gold, THEME.gold, 10);
        this.content.add(badge);
        this.content.add(mkText(this.scene, bx + badgeW / 2, ty + 20, label, 18, '#241a05', true).setOrigin(0.5));
        bx += badgeW + 16;
      });
      ty += 56;
    }

    ty += 20;
    if (this.renamingActive) {
      // The DOM input (created by startRename) floats over the customName
      // text above; these buttons replace RENAME/CONTINUE while it's open.
      this.content.add(new Button(this.scene, cx - 160, ty, 260, 60, 'SAVE', () => this.commitRename(line), THEME.accent, 22));
      this.content.add(new Button(this.scene, cx + 160, ty, 260, 60, 'CANCEL', () => this.cancelRename(), 0x8a8570, 22));
    } else {
      this.content.add(new Button(this.scene, cx - 160, ty, 260, 60, 'RENAME', () => this.startRename(line), THEME.info, 22));
      this.content.add(new Button(this.scene, cx + 160, ty, 260, 60, 'CONTINUE', () => this.handleContinue(), THEME.accent, 22));
    }
  }

  private startRename(line: Variety): void {
    this.renamingActive = true;
    this.render();
    this.createRenameInputDom(line);
  }

  private createRenameInputDom(line: Variety): void {
    this.destroyRenameInput();
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / LAYOUT.width;

    // Positioned directly over the customName text on the post-keep screen.
    const gameX = LAYOUT.width / 2 - 180;
    const gameY = 336;
    const gameW = 360;
    const gameH = 46;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = line.customName;
    input.maxLength = 24;
    Object.assign(input.style, {
      position: 'fixed',
      left: `${rect.left + gameX * scale}px`,
      top: `${rect.top + gameY * scale}px`,
      width: `${gameW * scale}px`,
      height: `${gameH * scale}px`,
      fontSize: `${22 * scale}px`,
      fontFamily: 'Georgia, "Trebuchet MS", sans-serif',
      textAlign: 'center',
      padding: '4px 8px',
      boxSizing: 'border-box',
      border: '2px solid #4c8a3a',
      borderRadius: '8px',
      zIndex: '10000',
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.commitRename(line);
      else if (e.key === 'Escape') this.cancelRename();
    });

    document.body.appendChild(input);
    this.renameInputEl = input;
    input.focus();
    input.select();
  }

  private commitRename(line: Variety): void {
    const value = this.renameInputEl?.value ?? '';
    const ok = this.game.renameLine(line.id, value);
    this.renamingActive = false;
    this.destroyRenameInput();
    if (ok && this.postKeepResult) {
      const updated = this.game.getVariety(line.id);
      if (updated) this.postKeepResult = { ...this.postKeepResult, line: updated };
    } else if (!ok) {
      this.toasts.show('Name cannot be empty.', THEME.danger);
    }
    this.render();
  }

  private cancelRename(): void {
    this.renamingActive = false;
    this.destroyRenameInput();
    this.render();
  }

  private destroyRenameInput(): void {
    if (this.renameInputEl) {
      this.renameInputEl.remove();
      this.renameInputEl = null;
    }
  }

  private handleContinue(): void {
    // selectedA/selectedB are untouched by the KEEP/post-keep flow, so
    // they're still exactly whatever the player last had selected —
    // CONTINUE deliberately does not plant/favorite/re-select the new
    // Line, it just returns to normal Breed setup.
    this.postKeepResult = null;
    this.render();
  }
}
