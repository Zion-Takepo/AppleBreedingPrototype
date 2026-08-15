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

new Phaser.Game(config);
