import Phaser from 'phaser';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

// Plain-English explanations of the five genetic stats — shown from a
// reusable "i" info button on both the Breed parent-selection screen and
// the offspring-result/candidate-selection screen (see PROJECT.md
// "Five-stat info button"). Deliberately does NOT claim Freshness already
// affects value — it doesn't yet.
const STAT_INFO: { label: string; description: string }[] = [
  { label: 'SWEETNESS', description: 'Strongly increases value per apple.' },
  { label: 'SIZE', description: 'Makes apples visually larger and gives a smaller increase to value per apple.' },
  {
    label: 'YIELD',
    description: 'Increases the number of productive fruit slots available at once. Current gameplay range is 9-15 productive slots.',
  },
  { label: 'GROWTH', description: 'Reduces the time required for a harvested fruit slot to grow its next apple.' },
  {
    label: 'FRESHNESS',
    description:
      'Currently exists as a genetic stat but has no economic gameplay effect yet. Planned future use: reduce value loss while harvested apples wait for shipping.',
  },
];

const MODAL_W = 1200;
const MODAL_H = 780;
const MARGIN_X = 90;

/**
 * Readable stat-help modal/panel (see PROJECT.md "Stat help modal
 * readability") — a proper large panel, never a tiny tooltip, with
 * generous width so no description line gets squeezed into a narrow
 * column. Same close behavior as every other modal in this codebase (X
 * button only — see modals.ts's createModal, which doesn't close on
 * outside-click either, so this deliberately doesn't invent that
 * behavior). Reused identically from both the parent-selection and
 * offspring-result Breed screens via createStatInfoButton below.
 */
export function openStatHelpModal(scene: Phaser.Scene): void {
  const modal = createModal(scene, MODAL_W, MODAL_H, THEME.panelBg);

  modal.root.add(mkText(scene, modal.x + MARGIN_X, modal.y + 32, 'GENETIC STATS', 34, THEME.textDark, true));
  const closeBtn = new Button(scene, modal.x + MODAL_W - 44, modal.y + 40, 56, 44, 'X', () => modal.close(), THEME.danger, 24);
  modal.root.add(closeBtn);

  const contentX = modal.x + MARGIN_X;
  const contentW = MODAL_W - MARGIN_X * 2;
  let y = modal.y + 108;

  STAT_INFO.forEach(({ label, description }) => {
    modal.root.add(mkText(scene, contentX, y, label, 25, THEME.textDark, true));
    y += 36;
    const desc = scene.add.text(contentX, y, description, {
      fontFamily: THEME.font,
      fontSize: '21px',
      color: THEME.textMid,
      wordWrap: { width: contentW, useAdvancedWrap: true },
      lineSpacing: 8,
    });
    modal.root.add(desc);
    y += desc.height + 34;
  });
}

/**
 * Small circular "i" info button that opens the shared stat-help modal
 * above — used identically on both Breed screens (see PROJECT.md section
 * 4). Deliberately skips Container.setSize() (which would force
 * originX/originY to 0.5 and require a top-left-relative hit area — see
 * uiKit.ts's Button doc comment for the exact pitfall) and instead defines
 * the hit circle directly at the button's true local center, the same
 * already-correct pattern OrchardTreeLayer's FruitSlot pivot uses. Hover
 * feedback is a color/alpha change only — never a scale change, per this
 * codebase's existing "no hover scaling" convention.
 */
export function createStatInfoButton(scene: Phaser.Scene, x: number, y: number, radius = 20): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const redraw = (hover: boolean) => {
    bg.clear();
    bg.fillStyle(THEME.info, 1);
    bg.fillCircle(0, 0, radius);
    if (hover) {
      bg.fillStyle(0xffffff, 0.16);
      bg.fillCircle(0, 0, radius);
    }
    bg.lineStyle(2, 0x000000, 0.18);
    bg.strokeCircle(0, 0, radius);
  };
  redraw(false);
  container.add(bg);

  const label = scene.add
    .text(0, 1, 'i', { fontFamily: THEME.font, fontSize: `${Math.round(radius * 1.25)}px`, color: THEME.textLight, fontStyle: 'bold' })
    .setOrigin(0.5);
  container.add(label);

  container.setInteractive(new Phaser.Geom.Circle(0, 0, radius), Phaser.Geom.Circle.Contains);
  container.on('pointerdown', () => openStatHelpModal(scene));
  container.on('pointerover', () => redraw(true));
  container.on('pointerout', () => redraw(false));

  scene.add.existing(container);
  return container;
}
