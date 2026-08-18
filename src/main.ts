import './style.css';
import Phaser from 'phaser';
import { MainScene } from './game/scenes/MainScene.ts';
import { LAYOUT } from './game/ui/theme.ts';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: LAYOUT.width,
  height: LAYOUT.height,
  backgroundColor: '#cfe8c8',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
  },
  scene: [MainScene],
};

// Pre-warm the Orchard typography pass's local variable fonts (declared via
// @font-face in style.css) before the game boots. Canvas-backed Phaser Text
// objects bake in whatever font is actually loaded at the moment they're
// created — there's no later "swap" repaint the way real DOM text gets — so
// without this, MainScene.create()'s Text objects could render with a
// fallback serif if the font files hadn't finished downloading yet. Falls
// through to booting anyway on failure (offline/unsupported browser) rather
// than blocking the game entirely.
async function boot(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('400 32px "Cormorant Garamond"'),
      document.fonts.load('700 32px "Cormorant Garamond"'),
      document.fonts.load('400 32px "Libre Baskerville"'),
      document.fonts.load('700 32px "Libre Baskerville"'),
    ]);
  } catch {
    // Fonts failed to load — boot anyway with whatever fallback CSS resolves to.
  }
  new Phaser.Game(config);
}

void boot();
