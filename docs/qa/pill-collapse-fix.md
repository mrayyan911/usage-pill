# Pill collapse height regression

The single-agent detail line rewrapped as the pill narrowed. A one-line
detail became two lines, increasing its intrinsic height by 14px. The two
fractional tracks shared an auto-height grid, so the parent retained the
taller content's height while redistributing space between the tracks.
It then snapped to compact height when the expanded track reached zero.

The initial Electron repro measured 64px expanded, 78px during collapse,
and 36px compact. Removing detail text removed the spike. Holding the
expanded content width steady removed the spike but retained the height
plateau and final snap.

The fix gives each row its own single-track collapsing grid, with an
unpadded clipping wrapper so it can reach zero. Expanded content keeps
the existing expanded layout width while the shell narrows. Height stays
intrinsic. No JavaScript state, delays, detection logic, endpoint geometry,
colors, or content styles changed. The existing easing and duration remain.

## Verification

Run `npm run test:renderer` for the optional animation regression and `npm test`
for the unit suite. The renderer command requires the installed Electron binary
and a display environment capable of running Electron. On headless Linux,
Electron's system libraries and a display server such as Xvfb are required.
The regression uses Electron, the production preload, real hover IPC,
and the production HTML, CSS, and renderer. It samples CSS transitions at
10ms intervals and also reverses running transitions on successive frames.

- Three window sizes: 280x102, 360x180, 800x600.
- One agent without detail, one-line detail, wrapped detail, and two agents.
- Three expand/collapse cycles per case, plus rapid enter/leave/enter.
- Width and height remain between endpoints and move monotonically.
- No final height snap; top edge and horizontal center remain fixed.
- Expanded heights remain 50px, 64px, 78px, and 74px respectively.
- All cases finish at the original 36px compact height.
- Combined validation: 86 unit tests and one renderer regression passed.

The original real-time repro also passed after the fix, shrinking from
64px through 59.5px, 55.4px, and subsequent smaller heights to 36px.
An isolated mock application was visually inspected at expanded,
mid-collapse, and compact states. Captures are in the ignored
`design-review/collapse-*.png` files.

The automated regression drives hover IPC directly. It does not automate
the physical Windows cursor or monitor/DPI changes. The main-process hover
poller, native window geometry, and session detection were not changed.
