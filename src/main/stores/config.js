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
 * `topCenterBounds()` computes the pill's default launch position: top-center
 * of the primary display. `pillHitRect()` is the actual on-screen rect of the
 * pill (much smaller than the pre-sized OS window) used for hover-to-expand
 * hit-testing. `clampToWorkArea()` is the raw bounds-clamping primitive;
 * `clampWindowToVisiblePill()` is what dragging actually uses -- it clamps
 * the *visible pill*, not the invisible pre-sized window around it, so the
 * hard stop lands where the user can see it rather than tens of pixels of
 * letterboxing short of the real edge. `resolveLaunchBounds()` picks
 * between a saved drag position and `topCenterBounds()` at launch.
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

  static clampToWorkArea(bounds, workArea) {
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);
    return {
      ...bounds,
      x: Math.min(Math.max(bounds.x, workArea.x), maxX),
      y: Math.min(Math.max(bounds.y, workArea.y), maxY),
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

  /**
   * Clamps the *visible pill* (via pillHitRect) into the work area, then
   * translates that correction back onto the window bounds -- the window
   * itself is allowed to sit partly off-screen in its own letterboxing, as
   * long as the pill inside it never does.
   */
  static clampWindowToVisiblePill(windowBounds, workArea, { expanded }) {
    const pillRect = ConfigStore.pillHitRect(windowBounds, { expanded });
    const clampedPillRect = ConfigStore.clampToWorkArea(pillRect, workArea);
    return {
      ...windowBounds,
      x: windowBounds.x + (clampedPillRect.x - pillRect.x),
      y: windowBounds.y + (clampedPillRect.y - pillRect.y),
    };
  }

  /**
   * Launch-time position: restore a saved drag position only if its display
   * is still connected (re-clamped in case that display's work area shrank
   * since saving), otherwise fall back to the default top-center-of-primary
   * spot -- covers both "never dragged" and "dragged, then that monitor got
   * unplugged" the same way.
   */
  static resolveLaunchBounds({ savedPosition, displays, primaryDisplay }) {
    if (savedPosition) {
      const display = displays.find((d) => d.id === savedPosition.displayId);
      if (display) {
        const bounds = { x: savedPosition.x, y: savedPosition.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
        return ConfigStore.clampToWorkArea(bounds, display.workArea);
      }
    }
    return ConfigStore.topCenterBounds(primaryDisplay);
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
