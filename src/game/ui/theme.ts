// Authored at 1600x900 (2x the original 800x450) so the canvas backing
// buffer has real pixel density instead of being CSS-stretched from a
// small buffer. This is a native resolution, not a runtime/camera scale —
// every UI coordinate in this codebase is authored directly in this space.
// See PROJECT.md's rendering-resolution note for why (previous dynamic
// resize / camera-zoom experiments caused regressions and were reverted).
export const LAYOUT = {
  width: 1600,
  height: 900,
  hudHeight: 64,
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
