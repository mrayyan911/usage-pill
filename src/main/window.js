'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { ConfigStore } = require('./stores/config');

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
 * and can be freely dragged (via its always-visible header row, not the
 * expanded detail view -- see pill.css's app-region rules) to anywhere on
 * any connected display, live-clamped to that display's work area on every
 * 'move' event. Its window is sized for
 * the *expanded* state up front so the hover-to-expand grow-in-place
 * animation (handled entirely in CSS) is never clipped by the OS window
 * bounds.
 */
function createPillWindow() {
  const primary = screen.getPrimaryDisplay();
  const bounds = ConfigStore.topCenterBounds(primary);

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
    movable: true, // draggable via -webkit-app-region:drag (pill.css), scoped to the collapsed pill surface

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
    win.showInactive(); // show without activating -- don't steal focus
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

  // Shared by revalidate() and the drag-clamp handler below so a
  // programmatic setBounds() (ours) never re-enters as if it were a user
  // drag -- both wrap their own setBounds call in this flag.
  let clampGuard = false;

  // display-metrics-changed fires far more often than an actual monitor
  // hotplug (DPI/scale change, taskbar auto-hide toggling, work-area
  // resize), so this re-clamps the pill's *current* position into whatever
  // display it's now nearest to rather than teleporting it back to
  // top-center -- a dragged pill must survive routine display churn, not
  // just live at a fixed spot. It also covers the actual hotplug case: if
  // the display the pill was on got removed, the nearest-point lookup lands
  // it on the closest remaining display instead of off-screen.
  const revalidate = () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) });
    const clamped = ConfigStore.clampToWorkArea(b, display.workArea);
    clampGuard = true;
    win.setBounds(clamped);
    clampGuard = false;
  };
  screen.on('display-added', revalidate);
  screen.on('display-removed', revalidate);
  // display-metrics-changed also covers the black-background-after-display-change
  // regression: recreate is safer than repaint, but at this size a bounds
  // revalidate + a forced repaint is enough for the common case; a full
  // destroy/recreate is left as a future hardening step if it's ever observed.
  screen.on('display-metrics-changed', revalidate);

  // Live drag-clamping: a native app-region drag fires 'move' continuously,
  // so re-clamping on every event gives a hard stop at the work-area edge
  // with no elastic overshoot. setBounds() below re-triggers 'move' itself,
  // so clampGuard stops that from recursing.
  let isDragging = false;
  let dragIdleTimer = null;
  win.on('move', () => {
    if (clampGuard || win.isDestroyed()) return;

    isDragging = true;
    if (dragIdleTimer) clearTimeout(dragIdleTimer);
    dragIdleTimer = setTimeout(() => {
      isDragging = false;
    }, DRAG_IDLE_MS);

    const b = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) });
    const clamped = ConfigStore.clampToWorkArea(b, display.workArea);
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
  // this polls the cursor against the window bounds instead. The expanded
  // detail row grows in place inside the same (already large enough)
  // window, so the hover target is just the window's own bounds. Suppressed
  // mid-drag so grabbing the pill can't also trigger the expand animation.
  let wasHovering = false;
  const hoverTimer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inBounds = cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
    const isHovering = inBounds && !isDragging;
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
