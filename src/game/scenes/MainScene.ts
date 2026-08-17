import Phaser from 'phaser';
import { Game } from '../Game.ts';
import { LAYOUT, THEME } from '../ui/theme.ts';
import { HUD } from '../ui/HUD.ts';
import { BottomNav, type ScreenId } from '../ui/BottomNav.ts';
import {
  ORCHARD_BACKGROUND_KEY,
  ORCHARD_BACKGROUND_PATH,
  ORCHARD_CLOUD_KEY,
  ORCHARD_CLOUD_PATH,
  ORCHARD_SKY_KEY,
  ORCHARD_SKY_PATH,
  ORCHARD_STATS_FRAME_KEY,
  ORCHARD_STATS_FRAME_PATH,
  OrchardScreen,
  WIND_FOLIAGE_TOP_LEFT_KEY,
  WIND_FOLIAGE_TOP_LEFT_PATH,
  WIND_FOLIAGE_TOP_RIGHT_KEY,
  WIND_FOLIAGE_TOP_RIGHT_PATH,
} from '../ui/OrchardScreen.ts';
import { ORCHARD_CANOPY_KEY, ORCHARD_CANOPY_PATH, ORCHARD_APPLE_BAGGED_KEY, ORCHARD_APPLE_BAGGED_PATH } from '../render/OrchardTreeLayer.ts';
import { BreedScreen } from '../ui/BreedScreen.ts';
import { CalendarScreen } from '../ui/CalendarScreen.ts';
import { CollectionScreen } from '../ui/CollectionScreen.ts';
import { ToastQueue } from '../ui/modals.ts';
import { showEndDaySummary } from '../ui/EndDayModal.ts';
import { showWeekSummary } from '../ui/WeekSummaryModal.ts';
import { DebugPanel } from '../ui/DebugPanel.ts';
import { OnboardingBanner } from '../ui/OnboardingBanner.ts';
import { openContestEntryModal } from '../ui/ContestEntryModal.ts';
import { openContestResultsModal } from '../ui/ContestResultsModal.ts';
import { APPLE_ASSET_IDS, appleAssetPath, appleTextureKey, catalogLabel } from '../render/appleAssets.ts';
import { playClosingBeginsCue, playContestResolvedCue, playExceptionalFoundCue, playNextDayBeginsCue, playPreClosingWarningCue, unlockAudio } from '../systems/audio.ts';
import { contestTypeForDay, contestTypeLabel, isContestDay } from '../systems/contest.ts';
import { formatExceptionalReveal } from '../systems/exceptionalReveal.ts';
import type { DayLogEntry } from '../types.ts';

const REFRESH_INTERVAL_MS = 120;

// Day-transition fade (see PROJECT.md "Day transition fade") — kept brief
// per the explicit target range, never several real seconds. Total transition
// (fade out + DAY N hold + fade in) stays inside the ~1-1.5s target.
const DAY_FADE_OUT_MS = 300;
const DAY_LABEL_HOLD_MS = 600;
const DAY_FADE_IN_MS = 400;
// Contest Day gets an expanded (but still short — see PROJECT.md "Contest"
// section 7) hold so "CONTEST DAY! <TYPE>" is actually readable, inside the
// suggested ~800-1000ms range rather than the normal day's 600ms.
const CONTEST_DAY_LABEL_HOLD_MS = 900;

// 18:00 Closing cue (see PROJECT.md "18:00 Closing cue") — total on-screen
// time stays inside the explicit 0.5-1.0s target (150ms in + 500ms hold +
// 200ms out = 850ms).
const CLOSING_CUE_IN_MS = 150;
const CLOSING_CUE_HOLD_MS = 500;
const CLOSING_CUE_OUT_MS = 200;

// Genetic Exceptional acquisition reveal (see PROJECT.md "Exceptional
// discovery/reveal UX") — held longer than a normal toast's default 1800ms
// since it carries several lines to actually read (archetype, a stat/TOTAL
// delta, the "saved as breeding specimen" line).
const EXCEPTIONAL_REVEAL_HOLD_MS = 3200;

export class MainScene extends Phaser.Scene {
  private logic!: Game;
  private hud!: HUD;
  private nav!: BottomNav;
  private toasts!: ToastQueue;
  private orchard!: OrchardScreen;
  private breed!: BreedScreen;
  private calendar!: CalendarScreen;
  private collection!: CollectionScreen;
  private onboardingBanner!: OnboardingBanner;
  private activeScreen: ScreenId = 'ORCHARD';
  private refreshAccum = 0;
  private speedMult = 1;
  private weekModalShown = false;
  // Guards against a double NEXT DAY activation (see PROJECT.md "Day
  // transition fade" section 9) while the fade-out/advance/fade-in sequence
  // is in flight.
  private dayTransitionInProgress = false;
  // Throttles the "PACKING FULL" toast (see PROJECT.md "Shipping
  // Infrastructure" section 5) — a hold-and-sweep drag over several
  // blocked ripe apples, or a single HARVEST ALL click blocked on many
  // slots at once, can fire 'packingFull' many times in one gesture; this
  // reuses one cooldown window instead of stacking dozens of toasts.
  private lastPackingFullToastMs = -Infinity;

  constructor() {
    super('MainScene');
  }

  preload(): void {
    // The 10 painterly apple illustrations, loaded once under stable keys
    // (e.g. "apple-C1") and used directly — no recoloring/reprocessing.
    for (const id of APPLE_ASSET_IDS) {
      this.load.image(appleTextureKey(id), appleAssetPath(id));
    }
    // Orchard layered art (see PROJECT.md orchard visual-integration pass)
    // — the approved external painterly layers, loaded once under stable
    // keys and used exactly as supplied by OrchardScreen/OrchardTreeLayer.
    this.load.image(ORCHARD_BACKGROUND_KEY, ORCHARD_BACKGROUND_PATH);
    this.load.image(ORCHARD_SKY_KEY, ORCHARD_SKY_PATH);
    this.load.image(ORCHARD_CLOUD_KEY, ORCHARD_CLOUD_PATH);
    this.load.image(ORCHARD_CANOPY_KEY, ORCHARD_CANOPY_PATH);
    this.load.image(ORCHARD_APPLE_BAGGED_KEY, ORCHARD_APPLE_BAGGED_PATH);
    this.load.image(ORCHARD_STATS_FRAME_KEY, ORCHARD_STATS_FRAME_PATH);
    this.load.image(WIND_FOLIAGE_TOP_LEFT_KEY, WIND_FOLIAGE_TOP_LEFT_PATH);
    this.load.image(WIND_FOLIAGE_TOP_RIGHT_KEY, WIND_FOLIAGE_TOP_RIGHT_PATH);
  }

  create(): void {
    this.logic = new Game();

    // Smooth (bilinear) filtering for the high-resolution source art —
    // matches the existing global antialias/pixelArt-off config, made
    // explicit per-texture rather than changing any renderer setting.
    for (const id of APPLE_ASSET_IDS) {
      this.textures.get(appleTextureKey(id)).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    this.textures.get(ORCHARD_BACKGROUND_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(ORCHARD_SKY_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(ORCHARD_CLOUD_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(ORCHARD_CANOPY_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(ORCHARD_STATS_FRAME_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(WIND_FOLIAGE_TOP_LEFT_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures.get(WIND_FOLIAGE_TOP_RIGHT_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const bg = this.add.graphics();
    bg.fillStyle(THEME.bgSky, 1);
    bg.fillRect(0, 0, LAYOUT.width, LAYOUT.height);

    this.toasts = new ToastQueue(this);

    this.orchard = new OrchardScreen(this, this.logic, this.toasts);
    this.breed = new BreedScreen(this, this.logic, this.toasts);
    this.calendar = new CalendarScreen(this, this.logic, this.toasts);
    this.collection = new CollectionScreen(this, this.logic);

    this.hud = new HUD(this, this.logic, () => this.onEndDay());
    this.nav = new BottomNav(this, this.logic, (id) => this.showScreen(id));
    this.onboardingBanner = new OnboardingBanner(this, this.logic, () => this.activeScreen);

    // DebugPanel added last so it renders/hits above nav.
    new DebugPanel(
      this,
      this.logic,
      () => this.speedMult,
      (m) => (this.speedMult = m),
    );

    // Unlocks the tiny procedural audio cues (see systems/audio.ts) on the
    // first genuine user gesture, per browser autoplay policy — safe/cheap
    // to leave attached for the whole scene lifetime since unlockAudio()
    // itself is idempotent once it succeeds.
    this.input.on('pointerdown', () => unlockAudio());

    this.logic.on((event) => {
      if (event.type === 'breedingReady' && this.activeScreen !== 'BREED') {
        this.toasts.show('Breeding complete! Check the BREED tab.', THEME.gold);
      }
      if (event.type === 'traitDiscovered' && this.activeScreen !== 'COLLECTION') {
        this.toasts.show('New trait discovered!', THEME.gold);
      }
      if (event.type === 'specimenAcquired') {
        if (event.specimen.exceptionalArchetype) {
          // Source Line's CURRENT Stats, looked up live — see
          // formatExceptionalReveal's own doc comment for why (and its safe
          // degradation to absolute values if the Line is somehow gone).
          const sourceLine = this.logic.getVariety(event.specimen.sourceLineId);
          const sourceStats = sourceLine
            ? { sweetness: sourceLine.sweetness, size: sourceLine.size, yieldStat: sourceLine.yieldStat, growth: sourceLine.growth, freshness: sourceLine.freshness }
            : undefined;
          this.toasts.show(formatExceptionalReveal(event.specimen, sourceStats), THEME.gold, EXCEPTIONAL_REVEAL_HOLD_MS);
          playExceptionalFoundCue();
        } else {
          this.toasts.show(`SPECIMEN ACQUIRED — ${catalogLabel(event.specimen.visualId)}`, THEME.gold);
        }
      }
      if (event.type === 'packingFull') {
        const now = this.time.now;
        if (now - this.lastPackingFullToastMs >= 1500) {
          this.lastPackingFullToastMs = now;
          const capacity = this.logic.packingCapacity();
          this.toasts.show(`PACKING FULL · ${this.logic.state.processingQueue.length}/${capacity}`, THEME.danger);
        }
      }
      // Closing (automatic 18:00 or manual END DAY — see Game.beginClosing)
      // finishes asynchronously once the accelerated Final Shipment queue
      // drains, so the summary modal is shown from this event rather than
      // synchronously from the END DAY click handler.
      if (event.type === 'dayClosed' && this.logic.state.lastDayLog) {
        this.showEndDayFlow(this.logic.state.lastDayLog);
      }
      // Pre-Closing warning (see PROJECT.md "Pre-Closing warning") — a
      // single compact, non-blocking toast at 17:00 plus a short audio cue;
      // the toast queue itself already handles fade in/out, auto-dismissal,
      // and serializing against any other toast in flight. Contest Day gets
      // Contest-specific wording instead of the generic warning (see
      // PROJECT.md "Contest" section 10) — still only the one warning, no
      // second toast added.
      if (event.type === 'closingWarning') {
        playPreClosingWarningCue();
        const contestToday = isContestDay(this.logic.state.day);
        this.toasts.show(contestToday ? 'CONTEST IN 1 HOUR · Prepare your best apple.' : 'CLOSING SOON · 1 HOUR', THEME.gold);
      }
      // Contest V1 (see PROJECT.md "Contest" sections 11-13) — Closing's
      // Final Shipment queue just emptied on a Contest Day, so today's
      // ContestState was just created.
      if (event.type === 'contestGateReached') {
        this.showContestEntryFlow();
      }
      // The full Contest outcome (score/rank/prize) was just generated —
      // show the Results screen. Settlement itself only happens once the
      // player continues past it (see Game.continueFromContestResults).
      if (event.type === 'contestResolved') {
        playContestResolvedCue();
        openContestResultsModal(this, this.logic);
      }
      // 18:00 Closing cue (see PROJECT.md "18:00 Closing cue") — only for
      // the automatic 18:00 trigger; a manual END DAY click already gives
      // the player immediate button feedback and doesn't need this.
      if (event.type === 'closingBegan' && event.automatic) {
        playClosingBeginsCue();
        this.showClosingCue();
      }
      // First-session onboarding completion (see PROJECT.md "First-session
      // onboarding" section 6) — a short toast, then the one-time Market
      // hint if it hasn't already fired from a day transition. The two
      // never visually overlap since both go through the same serialized
      // ToastQueue (see ui/modals.ts) — no artificial delay needed.
      if (event.type === 'onboardingComplete') {
        this.toasts.show('NEW LINE CREATED — Breed again to improve stats, specialize traits, or preserve a visual lineage.', THEME.gold);
        this.maybeShowMarketHint();
      }
      // Fallback Market-hint trigger (see PROJECT.md "Market discoverability")
      // — fires on every day transition, but maybeShowMarketHint() itself is
      // guarded by state.marketHintShown so it only ever actually shows once.
      if (event.type === 'dayAdvanced') {
        this.maybeShowMarketHint();
      }
    });

    this.showScreen('ORCHARD');
    this.refreshAll();
    // Short entrance fade (see PROJECT.md "Day transition fade" — "use a
    // short fade-in when initially entering the playable game").
    this.cameras.main.fadeIn(DAY_FADE_IN_MS, 0, 0, 0);

    // Root-cause fix for the "stuck on Day N, END DAY disabled forever"
    // bug: `dayEnded`/`weekComplete` are persisted GameState, but the
    // summary modals that gate proceeding past them are transient UI only
    // ever triggered by the END DAY click handler. A reload landing after
    // `endDay()`/`proceedToNextDay()` set that state but before the
    // player clicked through the modal(s) left no code path that could
    // ever show them again — the button just stays disabled ("END DAY ✓")
    // with no way forward. Re-entering the same flow here on load closes
    // that gap without changing the flow itself.
    // Contest V1's own reload-recovery (see PROJECT.md "Contest" section 19
    // — same root-cause fix as above, just for the Contest gate/results
    // window specifically): a reload landing after Closing reached the
    // Contest gate on today's day, but before settlement has actually run
    // (`state.closing` still true), re-enters exactly the right screen —
    // the entry screen if unresolved, the Results screen if already
    // resolved — instead of leaving the day permanently stuck mid-Contest.
    const contest = this.logic.state.contest;
    const contestPendingToday = contest !== null && contest.day === this.logic.state.day && this.logic.state.closing && !this.logic.state.dayEnded;

    if (this.logic.state.weekComplete) {
      this.showWeekSummaryFlow();
    } else if (this.logic.state.dayEnded && this.logic.state.lastDayLog) {
      this.showEndDayFlow(this.logic.state.lastDayLog);
    } else if (contestPendingToday && !contest!.resolved) {
      this.showContestEntryFlow();
    } else if (contestPendingToday && contest!.resolved) {
      openContestResultsModal(this, this.logic);
    }

    window.addEventListener('beforeunload', () => this.logic.save());

    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __debugGame?: Game;
        __debugOrchard?: OrchardScreen;
        __debugBreed?: BreedScreen;
        __debugActiveScreen?: () => ScreenId;
      };
      w.__debugGame = this.logic;
      w.__debugOrchard = this.orchard;
      w.__debugBreed = this.breed;
      // Verification-only: lets hitbox/boundary tests confirm which nav tab
      // is actually active without guessing from visual pixel sampling.
      w.__debugActiveScreen = () => this.activeScreen;
    }

    this.logRenderDiagnostics();
  }

  // Temporary, dev-only: proves what the canvas backing store actually is
  // vs. its CSS display size, to diagnose blur. Safe to delete later; does
  // not run in production builds.
  private logRenderDiagnostics(): void {
    if (!import.meta.env.DEV) return;
    const canvas = this.game.canvas;
    const cssRect = canvas.getBoundingClientRect();
    console.log('[render-diagnostics]', {
      logicalGameSize: `${this.sys.game.config.width}x${this.sys.game.config.height}`,
      canvasBackingSize: `${canvas.width}x${canvas.height}`,
      canvasCssDisplaySize: `${Math.round(cssRect.width)}x${Math.round(cssRect.height)}`,
      rendererResolutionProperty: 'not exposed by Phaser 4.2.1 (no such API — see report)',
      devicePixelRatio: window.devicePixelRatio,
    });
  }

  private showScreen(id: ScreenId): void {
    this.activeScreen = id;
    this.orchard.setVisible(id === 'ORCHARD');
    this.breed.setVisible(id === 'BREED');
    this.calendar.setVisible(id === 'CALENDAR');
    this.collection.setVisible(id === 'COLLECTION');
    this.nav.selectTab(id);
    // Onboarding step C completion (see PROJECT.md "First-session
    // onboarding" section 3) — a no-op unless the player's current goal is
    // exactly OPEN_BREED.
    if (id === 'BREED') this.logic.onboardingBreedScreenOpened();
    this.refreshAll();
  }

  private refreshAll(): void {
    this.hud.refresh();
    this.nav.refresh();
    this.onboardingBanner.refresh();
    if (this.activeScreen === 'ORCHARD') this.orchard.render();
    else if (this.activeScreen === 'BREED') this.breed.render();
    else if (this.activeScreen === 'CALENDAR') this.calendar.render();
    else if (this.activeScreen === 'COLLECTION') this.collection.render();
  }

  private onEndDay(): void {
    // Manual END DAY invokes the exact same Closing procedure the automatic
    // 18:00 trigger does (see Game.beginClosing) — the summary modal itself
    // is shown later, from the 'dayClosed' event once Closing actually
    // finishes (see the listener registered in create()).
    this.logic.beginClosing();
    this.refreshAll();
  }

  // Shows the end-day summary and — if it completes into a week-complete
  // state — the week summary after it. Re-entrant by design: called both
  // right after a normal END DAY click and from create() to recover a
  // reload that landed mid-flow (see the comment at that call site).
  private showEndDayFlow(log: DayLogEntry): void {
    // The Week Summary gate (see Game.proceedToNextDay) only ever fires on
    // the Day 7 -> 8 transition — every later day (Contest or not) uses the
    // normal "NEXT DAY →" label and advances straight through, so this
    // button-label special-case stays scoped to exactly that one day too.
    const isLastDay = this.logic.state.day === 7;
    showEndDaySummary(this, log, isLastDay, () => {
      // Day transition fade (see PROJECT.md "Day transition fade" section
      // 9) wraps the actual day-advance; the Week Summary modal (if this
      // was Day 7) is deliberately shown AFTER the fade-in completes,
      // rather than during the black window, so it appears over a settled,
      // already-reset Orchard screen instead of stacking mid-transition.
      this.runDayTransition(
        () => this.logic.proceedToNextDay(),
        () => {
          if (this.logic.state.weekComplete && !this.weekModalShown) {
            this.showWeekSummaryFlow();
          }
        },
      );
    });
  }

  // Fade out -> (while black) close transient UI, return to ORCHARD, run
  // `advance` -> show the newly-advanced "DAY N" label over black, held
  // briefly -> fade back in -> play the day-start cue -> `after`. Guards
  // against a double NEXT DAY activation via dayTransitionInProgress (see
  // PROJECT.md "Day transition fade").
  //
  // Uses a manual full-screen overlay + Text (not cameras.main.fadeOut/
  // fadeIn) specifically so the DAY N label can be shown while the screen
  // reads as fully black: Phaser's camera Fade FX is a post-render effect
  // applied on top of everything that camera draws, so a Game Object added
  // at any depth would still be hidden behind it. The overlay's own alpha
  // tween gives the exact same visual fade as the camera FX did.
  private runDayTransition(advance: () => void, after?: () => void): void {
    if (this.dayTransitionInProgress) return;
    this.dayTransitionInProgress = true;

    const overlay = this.add.rectangle(LAYOUT.width / 2, LAYOUT.height / 2, LAYOUT.width, LAYOUT.height, 0x000000, 1).setDepth(3000).setAlpha(0);
    const dayLabel = this.add
      .text(LAYOUT.width / 2, LAYOUT.height / 2, '', { fontFamily: THEME.font, fontSize: '72px', color: THEME.textGold, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(3001)
      .setAlpha(0);
    // Contest Day expansion of the same DAY N presentation (see PROJECT.md
    // "Contest" section 7) — a separate, smaller Text kept alongside
    // dayLabel (never mixed font sizes on one Text object), only populated
    // and faded in on a Contest Day; empty/invisible every other day.
    const contestLabel = this.add
      .text(LAYOUT.width / 2, LAYOUT.height / 2 + 90, '', { fontFamily: THEME.font, fontSize: '30px', color: THEME.textGold, align: 'center' })
      .setOrigin(0.5, 0)
      .setDepth(3001)
      .setAlpha(0);

    this.tweens.add({
      targets: overlay,
      alpha: 1,
      duration: DAY_FADE_OUT_MS,
      onComplete: () => {
        // Returning to ORCHARD also closes BreedScreen's own transient UI
        // (e.g. a stray rename DOM input — see BreedScreen.setVisible) since
        // it's no longer the visible screen. This is a UI/navigation reset
        // only — no genetics/Line/Specimen/Market state is touched here (see
        // PROJECT.md "Reset UI position at a new day").
        this.showScreen('ORCHARD');
        advance();
        this.refreshAll();

        // Uses the actual newly-advanced GameState day value — advance()
        // (proceedToNextDay/startNextWeek) has already run by this point.
        const newDay = this.logic.state.day;
        // `contestAlreadyResolvedToday` guards the one pre-existing quirk
        // this reuses rather than fights: Day 7's own END DAY -> CONTINUE →
        // button runs this exact transition a SECOND time while `state.day`
        // is still 7 (see Game.proceedToNextDay's Week-1-complete gate,
        // which holds the day number steady until START WEEK 2 is clicked)
        // — without this guard, the Day 7 Contest banner would incorrectly
        // reappear even though that Contest already resolved earlier the
        // same day, during Closing.
        const contestAlreadyResolvedToday = this.logic.state.contest?.day === newDay && this.logic.state.contest.resolved === true;
        const contestType = contestAlreadyResolvedToday ? null : contestTypeForDay(newDay);

        dayLabel.setText(`DAY ${newDay}`);
        dayLabel.setAlpha(1);
        if (contestType) {
          contestLabel.setText(`CONTEST DAY!\n${contestTypeLabel(contestType)}\n\nPrepare your best apple.`);
          contestLabel.setAlpha(1);
        }

        const holdMs = contestType ? CONTEST_DAY_LABEL_HOLD_MS : DAY_LABEL_HOLD_MS;
        this.time.delayedCall(holdMs, () => {
          playNextDayBeginsCue();
          this.tweens.add({
            targets: [overlay, dayLabel, contestLabel],
            alpha: 0,
            duration: DAY_FADE_IN_MS,
            onComplete: () => {
              overlay.destroy();
              dayLabel.destroy();
              contestLabel.destroy();
              this.dayTransitionInProgress = false;
              after?.();
            },
          });
        });
      },
    });
  }

  // 18:00 Closing cue (see PROJECT.md "18:00 Closing cue") — a short
  // centered presentation, entirely separate from the day-transition fade
  // above (Closing itself is not delayed by this; it's a purely visual
  // overlay while the existing capacity-aware collection proceeds
  // underneath it).
  private showClosingCue(): void {
    const cx = LAYOUT.width / 2;
    const cy = LAYOUT.height / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(2500);

    const bg = this.add.rectangle(0, 0, 460, 150, 0x1c1c14, 0.85).setOrigin(0.5);
    const title = this.add
      .text(0, -20, 'CLOSING', { fontFamily: THEME.font, fontSize: '44px', color: THEME.textGold, fontStyle: 'bold' })
      .setOrigin(0.5);
    const subtitle = this.add.text(0, 32, 'Final collection', { fontFamily: THEME.font, fontSize: '22px', color: THEME.textLight }).setOrigin(0.5);
    container.add([bg, title, subtitle]);
    container.setAlpha(0);

    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: CLOSING_CUE_IN_MS,
      onComplete: () => {
        this.time.delayedCall(CLOSING_CUE_HOLD_MS, () => {
          this.tweens.add({
            targets: container,
            alpha: 0,
            duration: CLOSING_CUE_OUT_MS,
            onComplete: () => container.destroy(),
          });
        });
      },
    });
  }

  // One-time-ever Market discoverability hint (see PROJECT.md "Market
  // discoverability") — safe to call from multiple trigger points since
  // markMarketHintShown() on Game is itself idempotent/guarded.
  private maybeShowMarketHint(): void {
    if (this.logic.state.marketHintShown) return;
    this.logic.markMarketHintShown();
    this.toasts.show('TIP: Market prices change each day. Click the Market headline to see discovered varieties.', THEME.info);
  }

  private showWeekSummaryFlow(): void {
    this.weekModalShown = true;
    showWeekSummary(this, this.logic, () => {
      this.weekModalShown = false;
      this.logic.startNextWeek();
      this.refreshAll();
    });
  }

  // Shared by the live 'contestGateReached' listener and the reload-
  // recovery check in create() (see PROJECT.md "Contest" section 12's
  // defensive no-softlock note) — a corrupted/legacy save with zero
  // eligible Lines skips straight past the entry screen with an explicit
  // "no entry" outcome instead of showing a selector with nothing to pick.
  private showContestEntryFlow(): void {
    if (this.logic.contestEligibleLines().length === 0) {
      this.logic.confirmContestEntry(null);
    } else {
      openContestEntryModal(this, this.logic);
    }
  }

  // Strategic pause (see PROJECT.md "Breed is a strategic pause"): every
  // sub-state reachable while BREED is the active main screen (parent
  // selection, LINES/SPECIMENS picker, Line/Specimen detail, the 5-stat
  // help modal, offspring comparison, KEEP/post-Breed UI) is rendered
  // either directly inside BreedScreen's own content or as a modal that
  // blocks input to the rest of the scene while open — so gating purely on
  // "is BREED the active screen" already covers every one of those nested
  // states with no extra tracking needed. Deliberately NOT gated while
  // Closing is already in progress or the day has already ended — merely
  // being on the BREED tab must never suspend an already-started
  // settlement flow (see beginClosing/finishClosing). No pause flag is
  // persisted: this is purely derived, each frame, from existing
  // (already-transient) navigation/day state, per PROJECT.md's explicit
  // "don't persist a pause flag unless genuinely required" guidance.
  //
  // This only pauses the farm/day SIMULATION (day clock, fruit growth,
  // shipping queue, Closing-by-time) — it must NOT stop an in-progress
  // Breed operation's own countdown, which needs to keep advancing (and
  // resolve) even while the player stays on the BREED screen the whole
  // time. Game.update()'s `pauseFarmSimulation` parameter enforces that
  // split internally, so this method is always called every frame
  // regardless of the pause state — only farm/day progression inside it is
  // conditionally skipped.
  private isBreedPauseActive(): boolean {
    return this.activeScreen === 'BREED' && !this.logic.state.closing && !this.logic.state.dayEnded;
  }

  update(_time: number, deltaMs: number): void {
    const dt = (deltaMs / 1000) * this.speedMult;
    const farmPaused = this.isBreedPauseActive();
    this.logic.update(dt, farmPaused);
    if (!farmPaused) {
      // Every real frame (not throttled to REFRESH_INTERVAL_MS) so fruit
      // reveal/sway tweens stay smooth. Orchard isn't even visible while
      // BREED is active, so skipping this during the pause is harmless.
      this.orchard.updateTrees(dt);
    }

    this.refreshAccum += deltaMs;
    if (this.refreshAccum >= REFRESH_INTERVAL_MS) {
      this.refreshAccum = 0;
      this.refreshAll();
      this.logic.save();
    }
  }
}
