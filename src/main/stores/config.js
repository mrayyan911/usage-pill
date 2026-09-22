'use strict';

// Compact "island" footprint -- widest case (two collapsed agent icons).
const PILL_WIDTH = 104;
const PILL_HEIGHT = 36;
// Expanded footprint on hover -- the pill grows in place to reveal the
// agent row(s), so the OS window is sized for the expanded state up front.
// A transparent window can't be resized without a visible flash, and
// "never clipped" matters more here than "small when idle". Height covers
// the tallest case: two stacked agent rows when both agents are busy at
// once (see reduce.js) -- a single-row expand just grows less far inside it.
const PILL_EXPANDED_WIDTH = 248;
const PILL_EXPANDED_HEIGHT = 78;
const TOP_MARGIN = 10; // sits just under the menu bar, like Dynamic Island
// Matches .pill's `margin-top: 6px` in pill.css -- the pill is top-aligned,
// not vertically centered, inside the OS window's extra padding. Keep in sync.
const PILL_TOP_OFFSET = 6;

const WINDOW_WIDTH = PILL_EXPANDED_WIDTH + 32;
const WINDOW_HEIGHT = PILL_EXPANDED_HEIGHT + 24;

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

  /**
   * The OS window is sized (and hit-testable) for the expanded state, but
   * the visible pill is much smaller than that while collapsed -- hovering
   * the pre-sized window's invisible margin must not count as hovering the
   * pill. Returns the actual on-screen rect of the pill for its current
   * state, centered the same way CSS centers it (`body { justify-content:
   * center }`, `.pill { margin-top: 6px }`).
   */
  static pillHitRect(windowBounds, { expanded }) {
    const width = expanded ? PILL_EXPANDED_WIDTH : PILL_WIDTH;
    const height = expanded ? PILL_EXPANDED_HEIGHT : PILL_HEIGHT;
    return {
      x: windowBounds.x + Math.round((windowBounds.width - width) / 2),
      y: windowBounds.y + PILL_TOP_OFFSET,
      width,
      height,
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
  PILL_TOP_OFFSET,
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
};
