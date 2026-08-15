import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { Variety } from '../types.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { LineCard } from './LineCard.ts';
import { renderLineDetail } from './LineDetail.ts';
import { createModal } from './modals.ts';

type Tab = 'FAVORITES' | 'RECENT' | 'ALL';
type SortMode = 'Recent' | 'Gen' | 'Sweetness' | 'Size' | 'Yield' | 'Growth' | 'Freshness';
const SORT_MODES: SortMode[] = ['Recent', 'Gen', 'Sweetness', 'Size', 'Yield', 'Growth', 'Freshness'];
const TABS: Tab[] = ['FAVORITES', 'RECENT', 'ALL'];

export interface LibraryPickerOptions {
  /** Header title, e.g. "SELECT PARENT A". */
  title: string;
  /** CTA button text shown once a Line is previewed, e.g. "SELECT AS PARENT A". */
  ctaLabel: string;
  /** Shown under the title when relevant, e.g. "PAIRING WITH: RED BASIC". */
  pairingWithLabel?: string;
  /** Only this Line's own id is excluded from the "PAIRING WITH" caller side — self-cross itself is otherwise fully allowed, so no line is ever filtered out of the list because of it. */
  onSelect: (line: Variety) => void;
}

const CARD_W = 284;
const CARD_H = 256;
const CARD_GAP = 16;
const COLS = 2;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;

function statValue(line: Variety, mode: SortMode): number {
  switch (mode) {
    case 'Gen':
      return line.generation;
    case 'Sweetness':
      return line.sweetness;
    case 'Size':
      return line.size;
    case 'Yield':
      return line.yieldStat;
    case 'Growth':
      return line.growth;
    case 'Freshness':
      return line.freshness;
    default:
      return 0;
  }
}

/**
 * Reusable Library browsing modal: FAVORITES/RECENT/ALL tabs, one sort
 * control, a compact card grid, and a detail panel with the explicit CTA
 * that actually commits a selection (clicking a card only previews it).
 * Used by BreedScreen's Parent A/B selection now; intended for reuse by
 * REPLANT and a future full Library screen.
 */
export function openLibraryPicker(scene: Phaser.Scene, game: Game, opts: LibraryPickerOptions): void {
  const modal = createModal(scene, 1560, 820, THEME.panelBg);
  const content = scene.add.container(0, 0);
  modal.root.add(content);

  let tab: Tab = 'ALL';
  let sortMode: SortMode = 'Recent';
  let ascending = false;
  let page = 0;
  let previewId: string | null = null;

  const leftX = modal.x + 28;
  const leftW = 600;
  const rightX = leftX + leftW + 32;
  const rightW = modal.x + modal.w - 28 - rightX;

  function recencyRank(line: Variety): number {
    const idx = game.state.recentParentIds.indexOf(line.id);
    if (idx >= 0) return idx;
    return 1000 - line.createdDay;
  }

  function tabLines(): Variety[] {
    const all = game.state.library.filter((l) => !l.archived);
    if (tab === 'FAVORITES') return all.filter((l) => l.favorite);
    if (tab === 'RECENT') {
      const byId = new Map(all.map((l) => [l.id, l]));
      return game.state.recentParentIds.map((id) => byId.get(id)).filter((l): l is Variety => !!l);
    }
    return all;
  }

  function sortedLines(): Variety[] {
    const lines = tabLines().slice();
    if (sortMode === 'Recent') lines.sort((a, b) => recencyRank(a) - recencyRank(b));
    else lines.sort((a, b) => statValue(b, sortMode) - statValue(a, sortMode));
    if (ascending) lines.reverse();
    return lines;
  }

  function redraw(): void {
    content.removeAll(true);

    // Header ---------------------------------------------------------
    content.add(mkText(scene, leftX, modal.y + 18, opts.title, 28, THEME.textDark, true));
    const closeBtn = new Button(scene, modal.x + modal.w - 40, modal.y + 34, 52, 40, 'X', () => modal.close(), THEME.danger, 22);
    content.add(closeBtn);
    if (opts.pairingWithLabel) {
      content.add(mkText(scene, leftX, modal.y + 52, opts.pairingWithLabel, 20, '#3b6db2', true));
    }

    // Tabs -------------------------------------------------------------
    const tabsY = modal.y + 84;
    const tabW = (leftW - 15 * (TABS.length - 1)) / TABS.length;
    TABS.forEach((t, i) => {
      const tx = leftX + i * (tabW + 15);
      const active = tab === t;
      const btn = new Button(
        scene,
        tx + tabW / 2,
        tabsY + 20,
        tabW,
        40,
        t,
        () => {
          tab = t;
          page = 0;
          redraw();
        },
        active ? THEME.accent : 0x8a8570,
        18,
      );
      content.add(btn);
    });

    // Sort row -----------------------------------------------------------
    const sortY = tabsY + 58;
    content.add(mkText(scene, leftX, sortY + 10, 'Sort:', 20, THEME.textMid));
    const sortBtn = new Button(
      scene,
      leftX + 130,
      sortY + 18,
      190,
      36,
      sortMode,
      () => {
        sortMode = SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length];
        page = 0;
        redraw();
      },
      THEME.info,
      18,
    );
    content.add(sortBtn);
    const dirBtn = new Button(
      scene,
      leftX + 130 + 190 / 2 + 40,
      sortY + 18,
      60,
      36,
      ascending ? 'LOW▲' : 'HIGH▼',
      () => {
        ascending = !ascending;
        redraw();
      },
      0x8a8570,
      15,
    );
    content.add(dirBtn);

    // Grid ---------------------------------------------------------------
    const lines = sortedLines();
    const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
    if (page >= totalPages) page = totalPages - 1;
    const pageLines = lines.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const gridY = sortY + 64;
    if (pageLines.length === 0) {
      content.add(
        mkText(
          scene,
          leftX,
          gridY + 40,
          tab === 'FAVORITES' ? 'No favorites yet — star a Line to add it here.' : 'No Lines here yet.',
          20,
          THEME.textMid,
        ),
      );
    }
    pageLines.forEach((line, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = leftX + col * (CARD_W + CARD_GAP);
      const cy = gridY + row * (CARD_H + CARD_GAP);
      const card = new LineCard(scene, cx, cy, CARD_W, CARD_H, line, {
        appleSizePx: 90,
        radarRadius: 40,
        selected: line.id === previewId,
        showFavoriteStar: true,
        radarLabels: false,
        onClick: () => {
          previewId = line.id;
          redraw();
        },
        onToggleFavorite: () => {
          game.toggleFavorite(line.id);
          redraw();
        },
      });
      content.add(card);
    });

    // Pagination -----------------------------------------------------------
    if (totalPages > 1) {
      const pagY = gridY + ROWS * (CARD_H + CARD_GAP) + 8;
      const prevBtn = new Button(scene, leftX + 30, pagY, 56, 36, '◀', () => {
        page = Math.max(0, page - 1);
        redraw();
      }, 0x8a8570, 18);
      prevBtn.setEnabled(page > 0);
      content.add(prevBtn);
      content.add(mkText(scene, leftX + 90, pagY - 10, `Page ${page + 1}/${totalPages}`, 18, THEME.textMid, false, true));
      const nextBtn = new Button(scene, leftX + 230, pagY, 56, 36, '▶', () => {
        page = Math.min(totalPages - 1, page + 1);
        redraw();
      }, 0x8a8570, 18);
      nextBtn.setEnabled(page < totalPages - 1);
      content.add(nextBtn);
    }

    // Detail panel --------------------------------------------------------
    const previewLine = previewId ? game.getVariety(previewId) : undefined;
    if (previewLine) {
      renderLineDetail(scene, content, rightX, modal.y + 24, rightW, previewLine, {
        ctaLabel: opts.ctaLabel,
        onCta: () => {
          opts.onSelect(previewLine);
          modal.close();
        },
        onToggleFavorite: () => {
          game.toggleFavorite(previewLine.id);
          redraw();
        },
      });
    } else {
      content.add(
        mkText(scene, rightX, modal.y + 300, 'Select a Line on the left to preview it here.', 22, THEME.textMid).setAlign('center'),
      );
    }
  }

  redraw();
}
