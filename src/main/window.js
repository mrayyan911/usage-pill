'use strict';

const path = require('node:path');
const { BrowserWindow, Menu, screen } = require('electron');
const { ConfigStore } = require('./stores/config');
const { PositionStore } = require('./stores/position');

const ALWAYS_ON_TOP_LEVEL = 'screen-saver'; // 'floating' (the alwaysOnTop:true default) sits BELOW the taskbar on Windows
const REASSERT_INTERVAL_MS = 30_000;
const HOVER_POLL_MS = 150;
// Windows doesn't emit a distinct "drag ended" event for an app-region drag --
// this much silence after the last 'move' event is treated as the drag being over.
const DRAG_IDLE_MS = 200;

/**
 * Creates the frameless, transparent, always-on-top pill and wires up the
 * platform behaviors the technical review flagged: correct stacking level,
 * show-without-stealing-focus, and recovery on display changes (the
 * "black box after a monitor hotplug" failure mode).
 *
 * The pill launches Dynamic-Island-style, top-center of the primary display,
 * and can be freely dragged (via its icon/bar surface in either collapsed
 * or expanded state, not the free-text detail line -- see pill.css's
 * app-region rules) to anywhere on any connected display, live-clamped to
 * that display's work area on every 'move' event. Its window is sized for
 * the *expanded* state up front so the hover-to-expand grow-in-place
 * animation (handled entirely in CSS) is never clipped by the OS window
 * bounds.
 */
function createPillWindow({ autoShow = true } = {}) {
  const primary = screen.getPrimaryDisplay();
  const bounds = ConfigStore.resolveLaunchBounds({
    savedPosition: PositionStore.load(),
    displays: screen.getAllDisplays(),
    primaryDisplay: primary,
  });

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,

    // Transparency / shape -- on Windows, roundedCorners is a no-op below
    // build 22000, so the rounding comes entirely from CSS border-radius.
    frame: false, // MANDATORY: transparent is ignored on Windows unless frameless
    transparent: true,
    backgroundColor: '#00000000', // #AARRGGBB only honored when transparent:true
    hasShadow: false, // a native shadow on a transparent window reads as a square box
    roundedCorners: false,

    resizable: false, // transparent windows are documented as not reliably resizable
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true, // draggable via -webkit-app-region:drag (pill.css), scoped to the pill's icon/bar surface

    alwaysOnTop: true, // level corrected to 'screen-saver' below, after show
    skipTaskbar: true,
    focusable: true, // NOT false -- implies skipTaskbar and is implicated in a
    // transparent+frameless+focusable:false+noThrottle drag/click bug

    show: false,
    paintWhenInitiallyHidden: true,

    title: 'Usage Pill',

    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // insurance; Win10 visibility-state logic already
      // keeps a visible, never-minimized window at 60fps
      devTools: !require('electron').app.isPackaged,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (autoShow) win.showInactive(); // show without activating -- don't steal focus
    win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  });

  win.on('blur', () => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  });

  const reassertTimer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(reassertTimer);
      return;
    }
    win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  }, REASSERT_INTERVAL_MS);
  win.on('closed', () => clearInterval(reassertTimer));

  // Shared mutable state across the blocks below:
  // - wasHovering: which rect (collapsed/expanded) is currently showing, so
  //   clamping and hit-testing both target the pill the user can actually see.
  // - clampGuard: set around every *programmatic* setBounds() call so it
  //   never re-enters the 'move' handler below as if it were a user drag.
  // - isDragging / dragIdleTimer: see the 'move' handler.
  let wasHovering = false;
  let clampGuard = false;
  let isDragging = false;
  let dragIdleTimer = null;
  let menuOpen = false;

  const restoreDefaultPosition = () => {
    // A pending drag save must not recreate the position after a reset.
    if (dragIdleTimer) clearTimeout(dragIdleTimer);
    dragIdleTimer = null;
    isDragging = false;
    clampGuard = true;
    try {
      win.setBounds(ConfigStore.topCenterBounds(screen.getPrimaryDisplay()));
    } finally {
      clampGuard = false;
    }
  };

  const positionMenu = Menu.buildFromTemplate([{
    label: 'Reset position',
    click: () => {
      if (win.isDestroyed()) return;
      PositionStore.clear();
      restoreDefaultPosition();
    },
  }]);

  const showPositionMenu = () => {
    if (win.isDestroyed() || menuOpen) return;
    menuOpen = true;
    positionMenu.popup({ window: win, callback: () => { menuOpen = false; } });
  };

  // Windows routes right-clicks on app-region:drag through the native
  // non-client menu event, bypassing webContents' context-menu event.
  win.on('system-context-menu', (event) => {
    event.preventDefault();
    showPositionMenu();
  });
  win.webContents.on('context-menu', (_event, params) => {
    const bounds = win.getBounds();
    const rect = ConfigStore.pillHitRect(bounds, { expanded: wasHovering });
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
    const clamped = ConfigStore.clampWindowToVisiblePill(b, display.workArea, { expanded: wasHovering });
    clampGuard = true;
    win.setBounds(clamped);
    clampGuard = false;
  };
  // A newly connected display can never be the one the pill is already on,
  // so there's nothing of the pill's own to revalidate here -- and doing so
  // anyway risked re-clamping against a *different*, unrelated display if it
  // happened to be nearer, dragging an untouched pill along with it.
  screen.on('display-removed', (_event, oldDisplay) => {
    if (win.isDestroyed()) return;
    if (!isOnDisplay(win.getBounds(), oldDisplay)) return; // unrelated disconnect -- leave position untouched
    // The pill's own display is gone: PositionStore's saved displayId (if
    // any) is now stale too, so this falls back the same way a fresh launch
    // would -- top-center of whichever display is primary now.
    restoreDefaultPosition();
  });
  screen.on('display-metrics-changed', (_event, display) => {
    if (win.isDestroyed()) return;
    if (!isOnDisplay(win.getBounds(), display)) return; // some other display's metrics changed -- leave position untouched
    revalidate();
  });

  // Live drag-clamping: a native app-region drag fires 'move' continuously,
  // so re-clamping on every event gives a hard stop at the work-area edge
  // with no elastic overshoot. setBounds() below re-triggers 'move' itself,
  // so clampGuard stops that from recursing.
  win.on('move', () => {
    if (clampGuard || win.isDestroyed()) return;

    isDragging = true;
    if (dragIdleTimer) clearTimeout(dragIdleTimer);
    dragIdleTimer = setTimeout(() => {
      isDragging = false;
      // No distinct drag-end event on Windows (see above), so this same
      // move-silence timeout doubles as the "persist the drop position"
      // signal -- writes are naturally debounced to once per drag, not once
      // per intermediate 'move'.
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      PositionStore.save({ x: b.x, y: b.y, displayId: nearestDisplayFor(b).id });
    }, DRAG_IDLE_MS);

    const b = win.getBounds();
    const display = nearestDisplayFor(b);
    const clamped = ConfigStore.clampWindowToVisiblePill(b, display.workArea, { expanded: wasHovering });
    if (clamped.x !== b.x || clamped.y !== b.y) {
      clampGuard = true;
      win.setBounds(clamped);
      clampGuard = false;
    }
  });
  win.on('closed', () => {
    if (dragIdleTimer) clearTimeout(dragIdleTimer);
  });

  // Hover-to-expand, detected from the main process: CSS :hover / renderer
  // DOM events are unreliable across the transparent surface on Windows, so
  // this polls the cursor against the pill's own rect instead. The OS window
  // is pre-sized for the *expanded* state (so the grow animation is never
  // clipped), which is much larger than the collapsed pill -- hit-testing
  // against the full window bounds would trigger expansion from well outside
  // the visible pill. `wasHovering` also picks which rect to test: the small
  // collapsed rect while collapsed (so only touching the pill expands it),
  // the larger expanded rect once expanded (so it doesn't snap shut the
  // moment the cursor drifts past the collapsed footprint). While a drag is
  // in progress the hover state is frozen at whatever it was when the drag
  // started, rather than re-tested: re-testing would both let a drag trigger
  // a brand new expand mid-grab, and -- worse -- collapse an already-expanded
  // card out from under the cursor the instant the drag begins (the card's
  // own drag handle, .agent-rows, only exists while expanded).
  const hoverTimer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    if (isDragging || menuOpen) return;
    const cursor = screen.getCursorScreenPoint();
    const b = ConfigStore.pillHitRect(win.getBounds(), { expanded: wasHovering });
    const isHovering = cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
    if (isHovering !== wasHovering) {
      wasHovering = isHovering;
      if (!win.isDestroyed()) win.webContents.send('pill:hover', isHovering);
    }
  }, HOVER_POLL_MS);
  win.on('closed', () => clearInterval(hoverTimer));

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return win;
}

module.exports = { createPillWindow, ALWAYS_ON_TOP_LEVEL };
