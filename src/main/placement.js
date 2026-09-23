'use strict';

const { ConfigStore } = require('./stores/config');
const { PositionStore } = require('./stores/position');

const HOVER_POLL_MS = 150;
// Windows has no drag-end event; move silence also debounces persistence.
const DRAG_IDLE_MS = 200;

function createPillPlacement({ screen, positions = PositionStore, timers = globalThis }) {
  const launchBounds = ConfigStore.resolveLaunchBounds({
    savedPosition: positions.load(),
    displays: screen.getAllDisplays(),
    primaryDisplay: screen.getPrimaryDisplay(),
  });

  function attach(win, createPositionMenu) {
    const subscriptions = [];
    const listen = (target, event, handler) => {
      target.on(event, handler);
      subscriptions.push(() => target.removeListener(event, handler));
    };

    // Shared mutable state across the blocks below:
    // - wasHovering / isExpanded: which rect (collapsed/expanded) is currently
    //   showing, so clamping and hit-testing both target the pill the user can
    //   actually see. isExpanded also tracks keyboard-driven expansion (via the
    //   'pill:expanded' IPC below), which can outlast pointer hover.
    // - clampGuard: set around every *programmatic* setBounds() call so it
    //   never re-enters the 'move' handler below as if it were a user drag.
    // - isDragging / dragIdleTimer: see the 'move' handler.
    let wasHovering = false;
    let isExpanded = false;
    let clampGuard = false;
    let isDragging = false;
    let dragIdleTimer = null;
    let menuOpen = false;

    // Keyboard inspection can outlast pointer hover; native drag bounds must
    // follow the renderer's actual expansion, including Escape dismissal.
    listen(win.webContents, 'ipc-message', (_event, channel, expanded) => {
      if (channel === 'pill:expanded' && typeof expanded === 'boolean') isExpanded = expanded;
    });

    const restoreDefaultPosition = () => {
      // A pending drag save must not recreate the position after a reset.
      if (dragIdleTimer) timers.clearTimeout(dragIdleTimer);
      dragIdleTimer = null;
      isDragging = false;
      clampGuard = true;
      try {
        win.setBounds(ConfigStore.topCenterBounds(screen.getPrimaryDisplay()));
      } finally {
        clampGuard = false;
      }
    };

    const positionMenu = createPositionMenu(() => {
      if (win.isDestroyed()) return;
      positions.clear();
      restoreDefaultPosition();
    });

    const showPositionMenu = () => {
      if (win.isDestroyed() || menuOpen) return;
      menuOpen = true;
      positionMenu.popup({ window: win, callback: () => { menuOpen = false; } });
    };

    // Windows routes right-clicks on app-region:drag through the native
    // non-client menu event, bypassing webContents' context-menu event.
    listen(win, 'system-context-menu', (event) => {
      event.preventDefault();
      showPositionMenu();
    });
    listen(win.webContents, 'context-menu', (_event, params) => {
      const bounds = win.getBounds();
      const rect = ConfigStore.pillHitRect(bounds, { expanded: isExpanded });
      const x = bounds.x + params.x;
      const y = bounds.y + params.y;
      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
        showPositionMenu();
      }
    });

    // True when the window's center currently falls inside `display`'s full
    // bounds (not workArea -- we want "which monitor is this on", not
    // "is it inside the taskbar-excluded region"). Used to tell a display
    // event that's actually about the pill's own monitor apart from one about
    // some other, unrelated display -- an unrelated hotplug must never move a
    // dragged pill.
    const nearestDisplayFor = (bounds) =>
      screen.getDisplayNearestPoint({ x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) });

    const isOnDisplay = (bounds, display) => {
      const cx = bounds.x + Math.floor(bounds.width / 2);
      const cy = bounds.y + Math.floor(bounds.height / 2);
      return (
        cx >= display.bounds.x &&
        cx < display.bounds.x + display.bounds.width &&
        cy >= display.bounds.y &&
        cy < display.bounds.y + display.bounds.height
      );
    };

    // display-metrics-changed fires far more often than an actual monitor
    // hotplug (DPI/scale change, taskbar auto-hide toggling, work-area
    // resize), so this re-clamps the pill's *current* position into its own
    // display's new work area rather than teleporting it back to top-center --
    // a dragged pill must survive routine display churn, not just live at a
    // fixed spot. Clamps the *visible pill* (clampWindowToVisiblePill), not
    // the larger pre-sized window, so the hard stop lands where the user can
    // actually see it.
    const revalidate = () => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = nearestDisplayFor(b);
      const clamped = ConfigStore.clampWindowToVisiblePill(b, display.workArea, { expanded: isExpanded });
      clampGuard = true;
      win.setBounds(clamped);
      clampGuard = false;
    };
    // A newly connected display can never be the one the pill is already on,
    // so there's nothing of the pill's own to revalidate here -- and doing so
    // anyway risked re-clamping against a *different*, unrelated display if it
    // happened to be nearer, dragging an untouched pill along with it.
    listen(screen, 'display-removed', (_event, oldDisplay) => {
      if (win.isDestroyed()) return;
      if (!isOnDisplay(win.getBounds(), oldDisplay)) return; // unrelated disconnect -- leave position untouched
      // The pill's own display is gone: PositionStore's saved displayId (if
      // any) is now stale too, so this falls back the same way a fresh launch
      // would -- top-center of whichever display is primary now.
      restoreDefaultPosition();
    });
    listen(screen, 'display-metrics-changed', (_event, display) => {
      if (win.isDestroyed()) return;
      if (!isOnDisplay(win.getBounds(), display)) return; // some other display's metrics changed -- leave position untouched
      revalidate();
    });

    // Live drag-clamping: a native app-region drag fires 'move' continuously,
    // so re-clamping on every event gives a hard stop at the work-area edge
    // with no elastic overshoot. setBounds() below re-triggers 'move' itself,
    // so clampGuard stops that from recursing.
    listen(win, 'move', () => {
      if (clampGuard || win.isDestroyed()) return;

      isDragging = true;
      if (dragIdleTimer) timers.clearTimeout(dragIdleTimer);
      dragIdleTimer = timers.setTimeout(() => {
        isDragging = false;
        // No distinct drag-end event on Windows (see above), so this same
        // move-silence timeout doubles as the "persist the drop position"
        // signal -- writes are naturally debounced to once per drag, not once
        // per intermediate 'move'.
        if (win.isDestroyed()) return;
        const b = win.getBounds();
        positions.save({ x: b.x, y: b.y, displayId: nearestDisplayFor(b).id });
      }, DRAG_IDLE_MS);

      const b = win.getBounds();
      const display = nearestDisplayFor(b);
      const clamped = ConfigStore.clampWindowToVisiblePill(b, display.workArea, { expanded: isExpanded });
      if (clamped.x !== b.x || clamped.y !== b.y) {
        clampGuard = true;
        win.setBounds(clamped);
        clampGuard = false;
      }
    });

    // Hover-to-expand, detected from the main process: CSS :hover / renderer
    // DOM events are unreliable across the transparent surface on Windows, so
    // this polls the cursor against the pill's own rect instead. The OS window
    // is pre-sized for the *expanded* state (so the grow animation is never
    // clipped), which is much larger than the collapsed pill -- hit-testing
    // against the full window bounds would trigger expansion from well outside
    // the visible pill. `isExpanded` also picks which rect to test: the small
    // collapsed rect while collapsed (so only touching the pill expands it),
    // the larger expanded rect once expanded (so it doesn't snap shut the
    // moment the cursor drifts past the collapsed footprint). While a drag is
    // in progress the hover state is frozen at whatever it was when the drag
    // started, rather than re-tested: re-testing would both let a drag trigger
    // a brand new expand mid-grab, and -- worse -- collapse an already-expanded
    // card out from under the cursor the instant the drag begins (the card's
    // own drag handle, .agent-rows, only exists while expanded).
    const hoverTimer = timers.setInterval(() => {
      if (win.isDestroyed() || !win.isVisible()) return;
      if (isDragging || menuOpen) return;
      const cursor = screen.getCursorScreenPoint();
      const b = ConfigStore.pillHitRect(win.getBounds(), { expanded: isExpanded });
      const isHovering = cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
      if (isHovering !== wasHovering) {
        wasHovering = isHovering;
        // Optimistic guess so the *next* poll tick's hit-test already uses the
        // right rect instead of waiting a full round trip. If keyboard
        // inspection is what's actually keeping the card expanded, this can
        // momentarily disagree with the renderer -- but 'pill:hover' below
        // drives the renderer's own updateExpansion(), which always replies
        // with the true value over the 'pill:expanded' IPC handled above, so
        // it corrects itself within the same tick.
        isExpanded = isHovering;
        if (!win.isDestroyed()) win.webContents.send('pill:hover', isHovering);
      }
    }, HOVER_POLL_MS);
    win.once('closed', () => {
      timers.clearTimeout(dragIdleTimer);
      timers.clearInterval(hoverTimer);
      for (const unsubscribe of subscriptions) unsubscribe();
    });
  }

  return { launchBounds, attach };
}

module.exports = { createPillPlacement };
