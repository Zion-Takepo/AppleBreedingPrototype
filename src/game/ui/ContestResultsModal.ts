import Phaser from 'phaser';
import type { Game } from '../Game.ts';
import { contestTypeLabel, formatContestScore, rankContestEntries } from '../systems/contest.ts';
import { THEME } from './theme.ts';
import { Button, text as mkText } from './uiKit.ts';
import { createModal } from './modals.ts';

const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];

function highlightBar(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(THEME.gold, 0.35);
  g.fillRoundedRect(x, y, w, h, 10);
  return g;
}

/**
 * Contest Results screen (see PROJECT.md "Contest" sections 15/17) — shown
 * immediately after Game.confirmContestEntry generates the outcome, before
 * End Day settlement. Re-derives the ranked list by re-sorting the already-
 * PERSISTED player/NPC scores (rankContestEntries is a pure sort — no new
 * randomness/rng call happens here), so this is safe to redraw on a reload
 * that lands after entry too (see MainScene's reload-recovery flow).
 * CONTINUE TO DAY SUMMARY calls Game.continueFromContestResults, which
 * itself emits 'dayClosed' — MainScene's existing listener for that event
 * is what shows EndDayModal next, so this doesn't need its own "what
 * happens after" callback.
 */
export function openContestResultsModal(scene: Phaser.Scene, game: Game): void {
  const contest = game.state.contest;
  if (!contest || !contest.resolved) return;

  const playerLineName = contest.entryLineId ? (game.getVariety(contest.entryLineId)?.customName ?? 'Your Entry') : null;
  const entries = [
    ...(contest.playerScore !== null ? [{ id: 'PLAYER', label: `YOU · ${playerLineName}`, score: contest.playerScore }] : []),
    ...(contest.npcResults ?? []).map((n) => ({ id: n.name, label: n.name, score: n.score })),
  ];
  const ranked = rankContestEntries(entries);

  const modal = createModal(scene, 900, 760, THEME.panelBg);
  const cx = modal.x + modal.w / 2;

  modal.root.add(mkText(scene, cx, modal.y + 26, contestTypeLabel(contest.type), 34, THEME.textDark, true).setOrigin(0.5, 0));
  modal.root.add(mkText(scene, cx, modal.y + 70, 'RESULTS', 24, THEME.textMid, true, true).setOrigin(0.5, 0));

  let ry = modal.y + 130;
  ranked.forEach((entry, i) => {
    const isPlayer = entry.id === 'PLAYER';
    if (isPlayer) modal.root.add(highlightBar(scene, modal.x + 40, ry - 10, modal.w - 80, 44));
    const rowColor = isPlayer ? '#1c1c14' : THEME.textDark;
    modal.root.add(mkText(scene, modal.x + 56, ry, ORDINALS[i] ?? `${i + 1}TH`, 22, rowColor, true, true));
    modal.root.add(mkText(scene, modal.x + 140, ry, entry.label, 22, rowColor, isPlayer));
    modal.root.add(mkText(scene, modal.x + modal.w - 56, ry, formatContestScore(entry.score), 22, rowColor, true, true).setOrigin(1, 0));
    ry += 50;
  });

  ry += 24;
  if (contest.rank === null) {
    modal.root.add(mkText(scene, cx, ry, 'NO ENTRY', 32, THEME.textMid, true).setOrigin(0.5, 0));
  } else {
    const placeLabel = `${ORDINALS[contest.rank - 1] ?? `${contest.rank}TH`} PLACE`;
    modal.root.add(mkText(scene, cx, ry, placeLabel, 34, contest.rank === 1 ? '#2f5a20' : THEME.textDark, true).setOrigin(0.5, 0));
    ry += 46;
    const prizeText = contest.prize > 0 ? `+$${contest.prize}` : 'NO PRIZE';
    modal.root.add(mkText(scene, cx, ry, prizeText, 30, contest.prize > 0 ? '#2f5a20' : THEME.textMid, true).setOrigin(0.5, 0));
  }

  const btn = new Button(
    scene,
    cx,
    modal.y + modal.h - 64,
    480,
    68,
    'CONTINUE TO DAY SUMMARY',
    () => {
      // Close THIS modal first, then trigger settlement — finishClosing()
      // (inside continueFromContestResults) synchronously emits 'dayClosed',
      // which MainScene turns straight into the EndDayModal. Closing this
      // modal first avoids the new modal stacking visually on top of this
      // one before it's gone (see PROJECT.md section 17: the player should
      // read the result, then move on — never a double-modal flash).
      modal.close();
      game.continueFromContestResults();
    },
    THEME.gold,
    24,
  );
  modal.root.add(btn);
}
