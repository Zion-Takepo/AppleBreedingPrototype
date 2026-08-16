import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Variety } from '../types.ts';
import { contestCriteriaLines, contestMainStatKey, contestTypeLabel, totalStat, type ContestStats } from '../systems/contest.ts';
import { LineCard } from './LineCard.ts';
import { renderLineDetail } from './LineDetail.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

const CARD_W = 284;
const CARD_H = 256;
const CARD_GAP = 16;
const COLS = 2;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;

const MAIN_STAT_LABEL: Record<keyof ContestStats, string> = {
  sweetness: 'Sweetness',
  size: 'Size',
  yieldStat: 'Yield',
  growth: 'Growth',
  freshness: 'Freshness',
};

/**
 * Blocking Contest entry screen (see PROJECT.md "Contest" section 12) —
 * shown after Final Shipment completes on a Contest Day. The player picks
 * exactly ONE permanent owned Line (never a Specimen — see
 * Game.contestEligibleLines) to represent them; nothing is consumed.
 * Confirming (ENTER APPLE, or CONTINUE WITH NO ENTRY in the defensive
 * zero-eligible-Lines fallback) calls Game.confirmContestEntry, which itself
 * emits `'contestResolved'` — MainScene's own listener for that event is
 * what actually opens the Results screen next, so this modal doesn't need
 * (and doesn't take) its own "what happens after" callback.
 */
export function openContestEntryModal(scene: Phaser.Scene, game: Game): void {
  const contest = game.state.contest;
  if (!contest) return;
  const type = contest.type;
  // null for GRAND_CHAMPION, which emphasizes TOTAL/overall stats instead
  // of one main stat (see PROJECT.md section 12).
  const mainKey = contestMainStatKey(type);

  const modal = createModal(scene, 1560, 820, THEME.panelBg);
  const content = scene.add.container(0, 0);
  modal.root.add(content);

  const leftX = modal.x + 28;
  const leftW = 600;
  const rightX = leftX + leftW + 32;
  const rightW = modal.x + modal.w - 28 - rightX;

  let page = 0;
  let previewId: string | null = null;

  function rankValue(line: Variety): number {
    return mainKey ? line[mainKey] : totalStat(line);
  }

  // Sorted by the relevant judging value, highest first — a convenience
  // default only; the player is always free to preview and ENTER any
  // eligible Line regardless of where it sorts (see PROJECT.md's "do not
  // force the mathematically best Line" guidance).
  function eligibleSorted(): Variety[] {
    return game.contestEligibleLines().slice().sort((a, b) => rankValue(b) - rankValue(a));
  }

  function redraw(): void {
    content.removeAll(true);

    content.add(mkText(scene, leftX, modal.y + 18, contestTypeLabel(type), 30, THEME.textDark, true));
    content.add(mkText(scene, leftX, modal.y + 56, 'CHOOSE YOUR ENTRY', 22, THEME.textMid, true));
    content.add(mkText(scene, leftX, modal.y + 88, contestCriteriaLines(type).join('   •   '), 17, THEME.textMid));

    const lines = eligibleSorted();
    const gridY = modal.y + 128;

    if (lines.length === 0) {
      // Defensive edge case (see PROJECT.md section 12): a corrupted/legacy
      // save with zero eligible Lines must never softlock the day.
      content.add(mkText(scene, leftX, gridY + 20, 'No eligible Lines are available for this Contest.', 22, THEME.textMid));
      const skipBtn = new Button(
        scene,
        leftX + 260,
        gridY + 90,
        460,
        60,
        'CONTINUE WITH NO ENTRY',
        () => {
          game.confirmContestEntry(null);
          modal.close();
        },
        THEME.accent,
        22,
      );
      content.add(skipBtn);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
    if (page >= totalPages) page = totalPages - 1;
    const pageLines = lines.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    pageLines.forEach((line, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = leftX + col * (CARD_W + CARD_GAP);
      const cy = gridY + row * (CARD_H + CARD_GAP);
      const statLabel = mainKey ? `${MAIN_STAT_LABEL[mainKey]} ${line[mainKey]}` : `TOTAL ${totalStat(line)}`;
      content.add(mkText(scene, cx + CARD_W / 2, cy - 6, statLabel, 16, '#8a6d1a', true).setOrigin(0.5, 1));
      const card = new LineCard(scene, cx, cy, CARD_W, CARD_H, line, {
        appleSizePx: 90,
        radarRadius: 40,
        selected: line.id === previewId,
        radarLabels: false,
        onClick: () => {
          previewId = line.id;
          redraw();
        },
      });
      content.add(card);
    });

    if (totalPages > 1) {
      const pagY = gridY + ROWS * (CARD_H + CARD_GAP) + 8;
      const prevBtn = new Button(
        scene,
        leftX + 30,
        pagY,
        56,
        36,
        '◀',
        () => {
          page = Math.max(0, page - 1);
          redraw();
        },
        0x8a8570,
        18,
      );
      prevBtn.setEnabled(page > 0);
      content.add(prevBtn);
      content.add(mkText(scene, leftX + 90, pagY - 10, `Page ${page + 1}/${totalPages}`, 18, THEME.textMid, false, true));
      const nextBtn = new Button(
        scene,
        leftX + 230,
        pagY,
        56,
        36,
        '▶',
        () => {
          page = Math.min(totalPages - 1, page + 1);
          redraw();
        },
        0x8a8570,
        18,
      );
      nextBtn.setEnabled(page < totalPages - 1);
      content.add(nextBtn);
    }

    // Detail panel — reuses the exact same enlarged Line-detail component
    // the Breed Library Picker uses (apple/name/rarity/Gen/labeled radar +
    // exact five stat numbers), with its own CTA omitted (ctaLabel/onCta
    // left unset) since Contest needs an ENTER APPLE button plus an extra
    // relevant-stat/TOTAL callout the shared component doesn't draw.
    const previewLine = previewId ? game.getVariety(previewId) : undefined;
    if (previewLine) {
      const detailY = modal.y + 24;
      renderLineDetail(scene, content, rightX, detailY, rightW, previewLine, {});

      const readoutY = detailY + 180 + 130 + 130; // below LineDetail's radar/five-stat block (see LineDetail.ts's own layout)
      const readoutText = mainKey
        ? `${MAIN_STAT_LABEL[mainKey]}: ${previewLine[mainKey]}`
        : `TOTAL: ${totalStat(previewLine)}  (Sweetness + Size + Yield + Growth + Freshness)`;
      content.add(mkText(scene, rightX, readoutY, readoutText, 24, '#8a6d1a', true));

      const enterBtn = new Button(
        scene,
        rightX + rightW / 2,
        readoutY + 70,
        rightW - 40,
        68,
        'ENTER APPLE',
        () => {
          game.confirmContestEntry(previewLine.id);
          modal.close();
        },
        THEME.accent,
        26,
      );
      content.add(enterBtn);
    } else {
      content.add(mkText(scene, rightX, modal.y + 300, 'Select a Line on the left to preview it here.', 22, THEME.textMid).setAlign('center'));
    }
  }

  redraw();
}
