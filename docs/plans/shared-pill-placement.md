# Shared pill placement

## Agreed scope

Extract shared pill placement into one module while preserving visible behavior.
The module owns launch restoration, drag clamping, delayed saving, hover
detection, menu coordination, reset, display recovery, timers, and event
subscriptions. Window closure releases the module's timers and subscriptions.
`window.js` retains native window creation, native menu creation, and stacking.

Preserve the existing policies:

- Restore saved positions using the full-window clamp.
- Clamp dragging against the visible collapsed or expanded pill.
- Expand at an edge without repositioning the window.
- Freeze hover while dragging or while the position menu is open.
- Save after 200 ms of move silence; reset cancels that pending save.
- Ignore unrelated display changes. Losing the pill's display restores the
  current primary display's default position without clearing the saved position.

## Agreed test seam

Exercise the placement module through window and display events, menu actions,
and elapsed time. Use deterministic window, display, persistence, and timer
adapters with the real geometry implementation. Observe resulting bounds,
saved positions, hover messages, and subscription cleanup. Keep existing
geometry and persistence tests.

## Validation

Run the placement tests during extraction, the full Node suite at completion,
and the Electron renderer regression. Launch the actual application in mock
mode and inspect the pill. Review the work against these requirements and the
repository standards before committing on the refactor branch.
