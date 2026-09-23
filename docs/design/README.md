# Usage Pill visual direction

The small reference screenshot is the visual source of truth. The written
[design verdict](../qa/Verdits/dynamic-island-agent-ui-design-verdict.md)
records its restrained appearance and sizing targets; the standalone small
reference image is not currently checked into this repository.

`usage-pill design.png` is a concept board for state structure only. Do not use
its enlarged scale, luminous borders, shadows, circular badges, or spacing as
styling instructions.

Open [the current state board](compact-state-board.html) at 100% browser zoom.
It uses actual Electron renderer captures at their native CSS dimensions.

| State | Width | Height |
| --- | --- | --- |
| Collapsed, one agent | 84px | 36px |
| Collapsed, two agents | 104px | 36px |
| Expanded, one agent | 248px | 50px |
| Expanded, two agents | 248px | 74px |

Single-agent metadata expands the height only as needed, up to 78px. Long
provider details wrap and scroll inside that bound rather than widening the pill.
The native transparent window includes space for the dark shadow; it does not
resize during expansion.

Expanded agent marks are buttons. Selecting one shows that agent's details
within the existing single-row 78px bound; `← Both` returns to the two-agent
overview. The tray's `Show usage details` action focuses these controls for
keyboard use. Escape or leaving the window closes inspection.

Blocked agents carry a static `!` marker in both sizes. Stale or errored
readings retain their numeric value with a separate `stale`/`unavailable`
label, so a live fetch error never reads as merely old data. Resting Claude marks use
slightly higher opacity to balance the silver Codex mark.

Icons use identical 20px slots but different SVG sizes (Claude 17px, Codex 14px)
to account for the wide pixel mark's shorter painted bounds and the round mark's
full viewBox. Matte terracotta and satin-silver SVG gradients share top-left lighting, shallow bevels, and a tiny dark contact shadow. Collapsed marks use a softer bevel; expanded marks reveal slightly more depth. Each SVG has unique gradient and clip IDs. There are no
avatar backgrounds. Tracks are 3px high and percentages are 11px/500.

Use an almost-black surface, a 5% white boundary, and a small dark shadow.
Activity is conveyed by a restrained icon pulse and faint bar sweep, only for
the working agent. Amber/red usage thresholds remain on the bars; there is no
outer glow or pulsing perimeter. Reduced-motion preferences disable animation.
