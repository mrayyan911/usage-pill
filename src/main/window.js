'use strict';

const path = require('node:path');
const { BrowserWindow, Menu, screen } = require('electron');
const { createPillPlacement } = require('./placement');

const ALWAYS_ON_TOP_LEVEL = 'screen-saver'; // 'floating' (the alwaysOnTop:true default) sits BELOW the taskbar on Windows
const REASSERT_INTERVAL_MS = 30_000;
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
  const placement = createPillPlacement({ screen });
  const bounds = placement.launchBounds;

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

  placement.attach(win, onReset => Menu.buildFromTemplate([{
    label: 'Reset position',
    click: onReset,
  }]));

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return win;
}

module.exports = { createPillWindow, ALWAYS_ON_TOP_LEVEL };
