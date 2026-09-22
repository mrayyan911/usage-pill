# Dynamic Island verdict fixes

Implemented and verified on 2026-09-22.

- Reduced collapsed footprints to 84 × 36px and 104 × 36px.
- Reduced expanded footprints to 248 × 50px and 248 × 74px.
- Removed ambient glow, pulsing danger perimeter, surface gradient, badge halos,
  and circular avatar tiles. Preserved threshold colors on usage bars.
- Balanced the two source marks with separate optical sizes inside 20px slots.
- Reduced progress tracks to 3px and percentage text to 11px/500 at 72% white.
- Moved padding inside collapsible grid rows so hidden rows take no space.
- Preserved per-agent animation, keyed DOM reuse, and bounded scrolling for long
  metadata. Single-agent details can extend the pill up to 78px.
- Documented visual reference priority in CLAUDE.md and docs/design/README.md.
  The replacement compact-state-board.html uses native-scale renderer captures.

Validation: 31 existing tests passed; git diff --check passed. The Electron mock
app was launched with npm start. Nine synthetic renderer cases were measured
through DevTools and captured: four principal states plus stale, sign-in,
offline, empty, and blocked. All fit the 280 × 102px native viewport without
horizontal overflow; blocked rows have no working shimmer. Screenshots were
visually inspected, including compact dual-agent and long status layouts.

Reproduction: launch mock mode with `npm start -- --remote-debugging-port=9335`,
then run `node design-review/verify-compact.cjs`. Captures and measurements are
under design-review/. The script temporarily supplies synthetic state/hover
callbacks to the actual renderer source and restores the app page afterward.

Limits: the separate small reference screenshot is absent from the repository,
so its written verdict supplied the sizing and styling targets. Native pointer
polling, monitor hotplug, and multiple desktop scale factors were not retested.
