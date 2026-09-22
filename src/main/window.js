'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { ConfigStore } = require('./stores/config');

const ALWAYS_ON_TOP_LEVEL = 'screen-saver'; // 'floating' (the alwaysOnTop:true default) sits BELOW the taskbar on Windows
const REASSERT_INTERVAL_MS = 30_000;
const HOVER_POLL_MS = 150;

/**
 * Creates the frameless, transparent, always-on-top pill and wires up the
 * platform behaviors the technical review flagged: correct stacking level,
 * show-without-stealing-focus, and recovery on display changes (the
 * "black box after a monitor hotplug" failure mode).
 *
 * The pill is Dynamic-Island-style: fixed top-center of the primary
 * display, not user-draggable. Its window is sized for the *expanded*
 * state up front so the hover-to-expand grow-in-place animation (handled
 * entirely in CSS) is never clipped by the OS window bounds.
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
    movable: false, // fixed Dynamic-Island-style position -- never user-draggable

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

  const revalidate = () => {
    if (win.isDestroyed()) return;
    win.setBounds(ConfigStore.topCenterBounds(screen.getPrimaryDisplay()));
  };
  screen.on('display-added', revalidate);
  screen.on('display-removed', revalidate);
  // display-metrics-changed also covers the black-background-after-display-change
  // regression: recreate is safer than repaint, but at this size a bounds
  // revalidate + a forced repaint is enough for the common case; a full
  // destroy/recreate is left as a future hardening step if it's ever observed.
  screen.on('display-metrics-changed', revalidate);

  // Hover-to-expand, detected from the main process: CSS :hover / renderer
  // DOM events are unreliable across the transparent surface on Windows, so
  // this polls the cursor against the pill's own rect instead. The OS window
  // is pre-sized for the *expanded* state (so the grow animation is never
  // clipped), which is much larger than the collapsed pill -- hit-testing
  // against the full window bounds would trigger expansion from well outside
  // the visible pill. `wasHovering` also picks which rect to test: the small
  // collapsed rect while collapsed (so only touching the pill expands it),
  // the larger expanded rect once expanded (so it doesn't snap shut the
  // moment the cursor drifts past the collapsed footprint).
  let wasHovering = false;
  const hoverTimer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
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
