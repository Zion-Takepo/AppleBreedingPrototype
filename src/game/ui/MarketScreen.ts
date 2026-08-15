import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { MarketHistoryPoint, VisualMarketEntry } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_ASSET_IDS, APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { formatMarketPct, initVisualMarketEntry } from '../systems/market.ts';
import { THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

const POS_COLOR = '#2f5a20';
const NEG_COLOR = '#b23b3b';
const COLS = 5;
const CARD_GAP = 16;
const CARD_H = 268;

// Ownership-status label colors — deliberately the same small, non-bold
// treatment for both states so the badge stays visually secondary to the
// apple image / price / trend / history (see PROJECT.md Market V1).
const OWNED_COLOR = POS_COLOR;
const DISCOVERED_ONLY_COLOR = THEME.textMid;

/**
 * Market V1 overview — a weather-report-style read of every DISCOVERED
 * Visual Variety's current price vs baseline, its trend, and a compact
 * history sparkline (see PROJECT.md Market V1). Undiscovered varieties
 * never appear here at all. This is the smallest V1 access path: opened
 * directly from the HUD's Market headline (see HUD.ts), reusing the
 * existing createModal/Button conventions rather than a new bottom-nav tab.
 */
export function openMarketOverview(scene: Phaser.Scene, game: Game): void {
  const state = game.state;
  // Stable catalog order (matches APPLE_CATALOG_NUMBER / catalogLabel), not
  // discovery order, so the grid doesn't reshuffle as new varieties appear.
  const discovered = APPLE_ASSET_IDS.filter((id) => state.discoveredVisualIds.includes(id));

  const modal = createModal(scene, 1520, 800, THEME.panelBg);
  const content = scene.add.container(0, 0);
  modal.root.add(content);

  content.add(mkText(scene, modal.x + 28, modal.y + 24, 'MARKET', 32, THEME.textDark, true));
  content.add(
    mkText(scene, modal.x + 28, modal.y + 64, "Today's prices for every variety you've discovered — one update per day.", 18, THEME.textMid),
  );
  const closeBtn = new Button(scene, modal.x + modal.w - 40, modal.y + 34, 52, 40, 'X', () => modal.close(), THEME.danger, 22);
  content.add(closeBtn);

  if (discovered.length === 0) {
    content.add(mkText(scene, modal.x + 28, modal.y + 140, 'No varieties discovered yet — breed to reveal Market prices.', 22, THEME.textMid));
    return;
  }

  const gridX = modal.x + 28;
  const gridY = modal.y + 108;
  const gridW = modal.w - 56;
  const cardW = (gridW - CARD_GAP * (COLS - 1)) / COLS;

  discovered.forEach((visualId, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = gridX + col * (cardW + CARD_GAP);
    const cy = gridY + row * (CARD_H + CARD_GAP);
    // Every discovered visualId gets a real entry the moment it's
    // discovered (see Game.resolveBreeding) — this fallback only guards
    // against a display-time edge case and is never persisted.
    const entry = state.visualMarket[visualId] ?? initVisualMarketEntry(visualId, state.day);
    // OWNED vs DISCOVERED ONLY is derived live from current Library state
    // every time the overview is opened/redrawn — never persisted onto the
    // Market entry itself, so it can never drift out of sync with Library
    // changes (keep/archive/etc).
    const owned = game.isVisualIdOwned(visualId);
    drawMarketCard(scene, content, cx, cy, cardW, CARD_H, entry, owned);
  });
}

function drawMarketCard(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  entry: VisualMarketEntry,
  owned: boolean,
): void {
  container.add(panel(scene, x, y, w, h, THEME.panelBg2, THEME.panelBorder, 14));

  const rarity = APPLE_RARITY[entry.visualId];
  const rarityColor = rarity === 'COMMON' ? THEME.textMid : '#b8860b';
  container.add(mkText(scene, x + 12, y + 10, catalogLabel(entry.visualId), 15, rarityColor, rarity !== 'COMMON', true));

  // Ownership-status badge — small, top-right corner (mirrors the
  // catalog label's top-left placement, same convention LineCard uses for
  // its favorite star), so a DISCOVERED-only variety can never be mistaken
  // for one the player actually owns without redesigning the card.
  const ownedLabel = owned ? 'OWNED' : 'DISCOVERED ONLY';
  const ownedColor = owned ? OWNED_COLOR : DISCOVERED_ONLY_COLOR;
  container.add(mkText(scene, x + w - 12, y + 11, ownedLabel, 12, ownedColor, false, true).setOrigin(1, 0));

  const appleSizePx = Math.min(w * 0.5, 92);
  const apple = new AppleVisual(scene, x + w / 2, y + 20 + appleSizePx / 2, appleSizePx);
  // Market is per Visual Variety, not per owned Line — there is no single
  // Line's genetic Size to reflect here, so the illustration is drawn at a
  // neutral mid Size (50) purely for a consistent on-screen scale.
  apple.draw({ visualId: entry.visualId, size: 50 });
  container.add(apple);

  let ty = y + 24 + appleSizePx + 14;
  const pctColor = entry.pct > 0.003 ? POS_COLOR : entry.pct < -0.003 ? NEG_COLOR : THEME.textMid;
  container.add(mkText(scene, x + w / 2, ty, formatMarketPct(entry.pct), 30, pctColor, true, true).setOrigin(0.5, 0));
  ty += 40;

  const trendColor = entry.trend === 'RISING' ? POS_COLOR : entry.trend === 'FALLING' ? NEG_COLOR : THEME.textMid;
  const trendLabel = entry.trend === 'RISING' ? '▲ RISING' : entry.trend === 'FALLING' ? '▼ FALLING' : '▬ STABLE';
  container.add(mkText(scene, x + w / 2, ty, trendLabel, 18, trendColor, true).setOrigin(0.5, 0));
  ty += 34;

  drawSparkline(scene, container, x + 16, ty, w - 32, 42, entry.history);
}

/** Compact ~5-day price-history line, self-normalized to its own min/max (padded to always include the 0% baseline) so small day-to-day moves stay visible. */
function drawSparkline(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  history: MarketHistoryPoint[],
): void {
  const g = scene.add.graphics();
  container.add(g);
  if (history.length === 0) return;

  const pcts = history.map((p) => p.pct);
  let min = Math.min(...pcts, 0);
  let max = Math.max(...pcts, 0);
  if (max - min < 0.02) {
    min -= 0.01;
    max += 0.01;
  }

  const n = history.length;
  const pointX = (i: number) => x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const pointY = (pct: number) => y + h - ((pct - min) / (max - min)) * h;

  if (min <= 0 && max >= 0) {
    g.lineStyle(1, 0x9c9484, 0.5);
    g.lineBetween(x, pointY(0), x + w, pointY(0));
  }

  g.lineStyle(2.5, THEME.accent, 0.9);
  g.beginPath();
  history.forEach((p, i) => {
    const px = pointX(i);
    const py = pointY(p.pct);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  });
  g.strokePath();

  const lastX = pointX(n - 1);
  const lastY = pointY(pcts[n - 1]);
  g.fillStyle(THEME.accent, 1);
  g.fillCircle(lastX, lastY, 3.5);
}
