import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import type { MarketHistoryPoint, VisualMarketEntry } from '../types.ts';
import { AppleVisual } from '../render/AppleVisual.ts';
import { APPLE_ASSET_IDS, APPLE_RARITY, catalogLabel } from '../render/appleAssets.ts';
import { formatMarketPct, initVisualMarketEntry } from '../systems/market.ts';
import { dailyChangeFromHistory, formatDailyChange, pctToChartUnit, zeroLineChartUnit } from '../systems/marketDisplay.ts';
import { THEME } from './theme.ts';
import { Button, panel, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

const POS_COLOR = '#2f5a20';
const NEG_COLOR = '#b23b3b';
const COLS = 5;
const CARD_GAP = 16;
const CARD_H = 280;

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
  // Current level — % above/below the normal baseline price (unchanged meaning).
  const pctColor = entry.pct > 0.003 ? POS_COLOR : entry.pct < -0.003 ? NEG_COLOR : THEME.textMid;
  container.add(mkText(scene, x + w / 2, ty, formatMarketPct(entry.pct), 30, pctColor, true, true).setOrigin(0.5, 0));
  ty += 36;

  // Today's movement — deliberately separate from the current level above:
  // the current % can stay well above baseline even on a day the price fell
  // (see PROJECT.md's Market graph clarity pass). Percentage POINTS, derived
  // straight from the newest two history entries, never invented. This is
  // now the ONLY directional indicator on the card — the separate RISING/
  // FALLING/STABLE text row was removed as redundant with this line (both
  // said the same thing); `entry.trend` itself is untouched and still drives
  // next-day Market bias exactly as before, it's just no longer echoed here
  // as its own visible row.
  const daily = dailyChangeFromHistory(entry.history);
  const dailyColor = daily.points === null || daily.points === 0 ? THEME.textMid : daily.points > 0 ? POS_COLOR : NEG_COLOR;
  container.add(mkText(scene, x + w / 2, ty, formatDailyChange(daily), 15, dailyColor, false, true).setOrigin(0.5, 0));
  ty += 26;

  // Freed vertical space (the removed trend row) goes to the sparkline
  // itself — same fixed -50%..+60% mapping, just taller/easier to read.
  drawSparkline(scene, container, x + 16, ty, w - 32, 64, entry.history);
}

/**
 * Compact ~5-day price-history line. Uses the SAME fixed +60%/0%/-50% vertical
 * mapping on every card (`pctToChartUnit`, see systems/marketDisplay.ts) —
 * never self-normalized to this card's own recent min/max — so cards stay
 * directly visually comparable and a +10% entry reads as only modestly above
 * the always-drawn 0% baseline line rather than exaggerated/inverted.
 */
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

  const n = history.length;
  const pointX = (i: number) => x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const pointY = (pct: number) => y + h - pctToChartUnit(pct) * h;

  // 0% reference line — always present since the fixed chart range always
  // spans 0%. Dashed + neutral gray (rather than solid) so it stays clearly
  // secondary to, and distinguishable from, the solid green history line
  // even where the two nearly overlap — a plain thin solid line in a
  // similar tone read as too close to the history line in playtest.
  g.lineStyle(1.5, 0x9a9690, 0.65);
  const zeroY = y + h - zeroLineChartUnit() * h;
  const dash = 5;
  const gap = 4;
  for (let dx = 0; dx < w; dx += dash + gap) {
    g.lineBetween(x + dx, zeroY, x + Math.min(dx + dash, w), zeroY);
  }

  if (n === 0) return;

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
  const lastY = pointY(history[n - 1].pct);
  g.fillStyle(THEME.accent, 1);
  g.fillCircle(lastX, lastY, 3.5);
}
