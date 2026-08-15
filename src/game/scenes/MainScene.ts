import Phaser from 'phaser';
import { Game } from '../Game.ts';
import { LAYOUT, THEME } from '../ui/theme.ts';
import { HUD } from '../ui/HUD.ts';
import { BottomNav, type ScreenId } from '../ui/BottomNav.ts';
import { OrchardScreen } from '../ui/OrchardScreen.ts';
import { BreedScreen } from '../ui/BreedScreen.ts';
import { CalendarScreen } from '../ui/CalendarScreen.ts';
import { CollectionScreen } from '../ui/CollectionScreen.ts';
import { ToastQueue } from '../ui/modals.ts';
import { showEndDaySummary } from '../ui/EndDayModal.ts';
import { showWeekSummary } from '../ui/WeekSummaryModal.ts';
import { DebugPanel } from '../ui/DebugPanel.ts';
import { APPLE_ASSET_IDS, appleAssetPath, appleTextureKey } from '../render/appleAssets.ts';
import type { DayLogEntry } from '../types.ts';

const REFRESH_INTERVAL_MS = 120;

export class MainScene extends Phaser.Scene {
  private logic!: Game;
  private hud!: HUD;
  private nav!: BottomNav;
  private toasts!: ToastQueue;
  private orchard!: OrchardScreen;
  private breed!: BreedScreen;
  private calendar!: CalendarScreen;
  private collection!: CollectionScreen;
  private activeScreen: ScreenId = 'ORCHARD';
  private refreshAccum = 0;
  private speedMult = 1;
  private weekModalShown = false;

  constructor() {
    super('MainScene');
  }

  preload(): void {
    // The 10 painterly apple illustrations, loaded once under stable keys
    // (e.g. "apple-C1") and used directly — no recoloring/reprocessing.
    for (const id of APPLE_ASSET_IDS) {
      this.load.image(appleTextureKey(id), appleAssetPath(id));
    }
  }

  create(): void {
    this.logic = new Game();

    // Smooth (bilinear) filtering for the high-resolution source art —
    // matches the existing global antialias/pixelArt-off config, made
    // explicit per-texture rather than changing any renderer setting.
    for (const id of APPLE_ASSET_IDS) {
      this.textures.get(appleTextureKey(id)).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }

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

    // DebugPanel added last so it renders/hits above nav.
    new DebugPanel(
      this,
      this.logic,
      () => this.speedMult,
      (m) => (this.speedMult = m),
    );

    this.logic.on((event) => {
      if (event.type === 'breedingReady' && this.activeScreen !== 'BREED') {
        this.toasts.show('Breeding complete! Check the BREED tab.', THEME.gold);
      }
      if (event.type === 'traitDiscovered' && this.activeScreen !== 'COLLECTION') {
        this.toasts.show('New trait discovered!', THEME.gold);
      }
      // Closing (automatic 18:00 or manual END DAY — see Game.beginClosing)
      // finishes asynchronously once the accelerated Final Shipment queue
      // drains, so the summary modal is shown from this event rather than
      // synchronously from the END DAY click handler.
      if (event.type === 'dayClosed' && this.logic.state.lastDayLog) {
        this.showEndDayFlow(this.logic.state.lastDayLog);
      }
    });

    this.showScreen('ORCHARD');
    this.refreshAll();

    // Root-cause fix for the "stuck on Day N, END DAY disabled forever"
    // bug: `dayEnded`/`weekComplete` are persisted GameState, but the
    // summary modals that gate proceeding past them are transient UI only
    // ever triggered by the END DAY click handler. A reload landing after
    // `endDay()`/`proceedToNextDay()` set that state but before the
    // player clicked through the modal(s) left no code path that could
    // ever show them again — the button just stays disabled ("END DAY ✓")
    // with no way forward. Re-entering the same flow here on load closes
    // that gap without changing the flow itself.
    if (this.logic.state.weekComplete) {
      this.showWeekSummaryFlow();
    } else if (this.logic.state.dayEnded && this.logic.state.lastDayLog) {
      this.showEndDayFlow(this.logic.state.lastDayLog);
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
    this.refreshAll();
  }

  private refreshAll(): void {
    this.hud.refresh();
    this.nav.refresh();
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
    const isLastDay = this.logic.state.day >= 7;
    showEndDaySummary(this, log, isLastDay, () => {
      this.logic.proceedToNextDay();
      this.refreshAll();
      if (this.logic.state.weekComplete && !this.weekModalShown) {
        this.showWeekSummaryFlow();
      }
    });
  }

  private showWeekSummaryFlow(): void {
    this.weekModalShown = true;
    showWeekSummary(this, this.logic, () => {
      this.weekModalShown = false;
      this.logic.startNextWeek();
      this.refreshAll();
    });
  }

  update(_time: number, deltaMs: number): void {
    const dt = (deltaMs / 1000) * this.speedMult;
    this.logic.update(dt);
    // Every real frame (not throttled to REFRESH_INTERVAL_MS) so fruit
    // reveal/sway tweens stay smooth.
    this.orchard.updateTrees(dt);

    this.refreshAccum += deltaMs;
    if (this.refreshAccum >= REFRESH_INTERVAL_MS) {
      this.refreshAccum = 0;
      this.refreshAll();
      this.logic.save();
    }
  }
}
