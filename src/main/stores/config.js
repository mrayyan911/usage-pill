'use strict';

// Compact "island" footprint.
const PILL_WIDTH = 240;
const PILL_HEIGHT = 36;
// Expanded footprint on hover -- the pill grows in place to reveal the
// detail row, so the OS window is sized for the expanded state up front.
// A transparent window can't be resized without a visible flash, and
// "never clipped" matters more here than "small when idle".
const PILL_EXPANDED_WIDTH = 260;
const PILL_EXPANDED_HEIGHT = 78;
const TOP_MARGIN = 10; // sits just under the menu bar, like Dynamic Island

const WINDOW_WIDTH = PILL_EXPANDED_WIDTH + 8;
const WINDOW_HEIGHT = PILL_EXPANDED_HEIGHT + 8;

/**
 * The pill is a fixed Dynamic-Island-style overlay: top-center of the
 * primary display, never user-repositionable. There is nothing to persist --
 * position is recomputed from the current primary display on launch and on
 * every display change (monitor hotplug included).
 */
class ConfigStore {
  static topCenterBounds(primaryDisplay) {
    const area = primaryDisplay.workArea;
    return {
      x: area.x + Math.round((area.width - WINDOW_WIDTH) / 2),
      y: area.y + TOP_MARGIN,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    };
  }
}

module.exports = {
  ConfigStore,
  PILL_WIDTH,
  PILL_HEIGHT,
  PILL_EXPANDED_WIDTH,
  PILL_EXPANDED_HEIGHT,
  TOP_MARGIN,
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
};
