// Authored at 1600x900 (2x the original 800x450) so the canvas backing
// buffer has real pixel density instead of being CSS-stretched from a
// small buffer. This is a native resolution, not a runtime/camera scale —
// every UI coordinate in this codebase is authored directly in this space.
// See PROJECT.md's rendering-resolution note for why (previous dynamic
// resize / camera-zoom experiments caused regressions and were reverted).
export const LAYOUT = {
  width: 1600,
  height: 900,
  // Top HUD is now several separate cards (DAY/TIME, CASH, MARKET, CONTEST,
  // END DAY) with visible gaps between them, not one full-width strip — see
  // ui/HUD.ts and PROJECT.md "Orchard UI redesign". Raised from the old
  // single-row 64px bar to fit the card's own top/bottom margins.
  hudHeight: 84,
  navHeight: 88,
  get contentTop() {
    return this.hudHeight;
  },
  get contentBottom() {
    return this.height - this.navHeight;
  },
  get contentHeight() {
    return this.contentBottom - this.contentTop;
  },
};

export const THEME = {
  bgSky: 0xcfe8c8,
  panelBg: 0xfbf8ef,
  panelBg2: 0xf1ecd9,
  panelBorder: 0xc8bd9c,
  hudBg: 0x2c3b26,
  navBg: 0x263420,
  navActive: 0x4c8a3a,
  accent: 0x4c8a3a,
  accentDark: 0x2f5a20,
  gold: 0xc9962c,
  danger: 0xb23b3b,
  info: 0x3b6db2,
  textDark: '#2b2b20',
  textMid: '#5b5548',
  textLight: '#fbf8ef',
  textGold: '#f2d27a',
  font: 'Georgia, "Trebuchet MS", sans-serif',
  // Georgia's default digits are old-style (text) figures — uneven height,
  // some dipping below the baseline — which reads as visually "off" next
  // to plain UI numerals (money, day count, stats, prices). Trebuchet MS
  // is already the declared fallback in `font` above; leading with it here
  // (same font stack, just reordered) gives lining figures without
  // introducing a new typeface. Used only for numeral-heavy text.
  fontNumeric: '"Trebuchet MS", Georgia, sans-serif',
};

// High-DPI text sharpness (Orchard typography pass). Phaser 4.2.1 exposes no
// global renderer `resolution` GameConfig property (confirmed dead end — see
// MainScene.logRenderDiagnostics), but every individual Text object accepts
// its own `resolution` style value ("DPI setting", default effectively 1).
// Applied to the shared text()/Button helpers in uiKit.ts so canvas-backed
// glyphs sample at real device pixel density instead of blurring when the
// 1600x900-authored canvas is CSS-scaled up to fill the viewport. Capped at
// 2 — this is still flat 2D UI text, not something that benefits from
// arbitrarily large backing textures on very-high-DPI displays.
export const TEXT_RESOLUTION = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

// Very subtle lift for warm-cream text sitting directly on dark-green
// panels (Orchard typography pass "TEXT RENDERING QUALITY" — explicitly
// capped at a soft, barely-there shadow: ~30% black, ~1px down, tiny blur).
// Never used on the dark-panel-on-cream case (textDark on cream already has
// enough natural contrast) — only opted into per call site below.
export const DARK_PANEL_TEXT_SHADOW = {
  offsetX: 0,
  offsetY: 1,
  color: 'rgba(0,0,0,0.3)',
  blur: 1,
  fill: true,
};

// Orchard presentation palette (see PROJECT.md "Orchard UI redesign" /
// "COLOR SYSTEM") — warm, elegant, pastoral, scenery-first. Deliberately a
// SEPARATE set of tokens from THEME above rather than edits to it: THEME's
// existing keys (accent/gold/hudBg/navBg/etc.) are still read by
// Breed/Calendar/Collection and various modals, which this pass explicitly
// does not restyle. Used by the shared always-visible chrome this pass DOES
// target (HUD, BottomNav) and by OrchardScreen's own cards.
export const ORCHARD = {
  forestDeep: 0x17351f,
  forestMid: 0x3f6a39,
  cream: 0xf4eed6,
  creamStr: '#f4eed6',
  // Secondary cream tone for controls deliberately subordinate to the
  // primary deep-forest/gold actions (e.g. CHANGE LINE, unselected
  // Cultivation segments) — see PROJECT.md "Orchard UI Final Structure +
  // Styling Pass" gold-usage rule: gold is an accent, not a general fill.
  mutedCream: 0xded5af,
  mutedCreamStr: '#ded5af',
  gold: 0xc7a24a,
  // Small-heading/secondary-accent text color on dark-green panels (Orchard
  // typography pass "COLOR SYSTEM") — used only for text, never for the
  // graphic frame/icon accents above, which stay on the original `gold`.
  goldStr: '#d1ae55',
  goldHighlight: 0xe1c56a,
  goldHighlightStr: '#e1c56a',
  // Main text/numbers on cream/light panels (Orchard typography pass).
  textDark: '#3d382b',
  // Secondary labels on cream/light panels (Orchard typography pass) —
  // e.g. stat labels, CULTIVATION.
  textMutedOnCream: '#6c624b',
  // Main text on dark-green panels (Orchard typography pass).
  textWarmLight: '#f4e8c1',
  // Local variable fonts (see public/assets/fonts/) — loaded via @font-face
  // in style.css and pre-warmed in main.ts before the Phaser game boots, so
  // no external Google Fonts runtime dependency and no fallback-font flash
  // on first paint. fontDisplay is the decorative headline/action serif
  // (Cormorant Garamond); fontBody is the readable secondary serif (Libre
  // Baskerville). Scoped to the ORCHARD token set only — Breed/Calendar/
  // Collection keep THEME.font untouched, per this pass's "Orchard screen
  // only" scope.
  fontDisplay: '"Cormorant Garamond", Georgia, serif',
  fontBody: '"Libre Baskerville", Georgia, serif',
};
