# Release readiness QA - 2026-10-01

The reported input, idle-state, and next-day usage failures were reproduced and
fixed on `fix/release-readiness`. Additional regressions found during QA were
fixed too. This report records the evidence and the limits of the validation.

## Findings and fixes

| Finding | Reproduction | Resulting behavior |
| --- | --- | --- |
| Transparent margins intercept clicks | Cursor inside the native window but outside a collapsed pill; repeat below a one-row expanded card | Mouse input passes to the underlying window. Renderer-reported dimensions govern hit testing during expansion and collapse. |
| Native badge clicks disappear | Click the center of a badge using Windows mouse input | Badge inspection works. A fixed drag handle beside the button replaces inherited drag regions on moving bar content. |
| Old work revives when a new CLI opens | Yesterday's unfinished activity file plus a process created today, for each agent | Files older than the current CLI processes cannot report working. Initial process detection and failed subsequent polls cannot bypass this check. |
| Missed Claude Stop leaves working visible | Hook start followed by a newer completed transcript for the same session | The completed transcript clears working. Permission-prompt hooks still retain their blocked state. |
| Interrupted subagents prevent idle | Start, subagent start, then Stop or SessionEnd without a subagent stop | The terminal hook event clears the unfinished subagent state. A synthetic fixture preserves this sequence. |
| New Codex roots inherit older usage or activity | New root contains no rate limits or no first turn; older root contains usage and an unfinished turn | The newest root supplies its own reading and initial idle state. Missing usage stays unknown. Subagent usage remains excluded. |
| Percentages survive their reset | Advance time past a usage reset, including a failed Claude refresh | Expired primary and weekly readings become unknown independently. A real provider-reported zero remains valid. |
| Polling old Codex files implies fresh data | Poll an unchanged rate-limit sample after advancing time | Sample time governs freshness instead of the latest poll time. |
| Stale text falsely diagnoses a connection failure | Render an expired local reading without a percentage | The detail says the usage reading is out of date. |
| Renderer tests inherit user zoom and race for cache files | Existing test profile at 200% zoom produced a 140px viewport in a 280px window | Each Electron test uses temporary app data and a separate Chromium profile. Animation checks then pass at the intended viewport sizes. |

## Regression evidence

Before fixes, this deterministic command reproduced the original three cases:

```text
node --test test/placement.test.js test/activity.test.js test/codex-provider.test.js
tests 29; pass 26; fail 3
Claude: working instead of idle
Codex: 10 instead of null
Transparent margin: mouse input remained captured
```

Additional checks failed before their corresponding fixes. The native badge
regression was also verified against the original CSS after the mouse driver
was made asynchronous; it failed to open details. The fixed CSS passes the
same native check, including actual dragging.

## Validation

| Check | Outcome |
| --- | --- |
| `npm.cmd test` | 176 tests passed; zero failures or skips |
| `npm.cmd run test:renderer` | Three Electron checks passed: animation cycles/reversals, session display, and details/keyboard inspection |
| `npm.cmd run test:native` | Windows desktop regression passed: collapsed and expanded margin click-through, hover, badge inspection, and dragging |
| `USAGE_PILL_MOCK=1 npm.cmd start` with isolated app data | Actual app launched; collapsed pill inspected visually |
| `npm.cmd pack --dry-run --json --cache docs/qa/bugs/npm-cache` | 41 package files; runtime source, preload, hooks, renderer, and launch scripts included; test fixtures and screenshots excluded |
| `git diff --check` | Passed |

The unit suite also covers simultaneous agents, independent usage errors,
permission blocking, partial/corrupt records, large rollouts, subagent usage
exclusion, file replacement, process exits and PID reuse, failed process polls,
visibility, startup failure exit codes, position persistence, display changes,
and timer/listener cleanup. Those checks use the real application functions
with deterministic filesystem, process, or provider inputs where appropriate.

The animation check exercises one and two rows, detail wrapping, three viewport
sizes, repeated expansion/collapse, and rapid reversals. Details checks exercise
badge selection, selection removal, row reordering, focus preservation, Escape,
window blur, pending readings, stale/error labels, and a neutral placeholder.

Native input runs separately because it opens test windows and moves the system
mouse. The driver restores the cursor and removes temporary profiles. Captured
synthetic screenshots are local artifacts under `docs/qa/bugs/`, excluded from
Git and the npm package. No credentials or real transcript contents are recorded.

## Validation limits

Native input was tested on this Windows desktop at its current display scale.
Pre-commit reruns exposed intermittent control-click and hover failures on the
live desktop. The control window now stays above unrelated applications and
below the pill, and hover failures include cursor/window geometry. The final
isolated rerun passed. Run native checks separately from other desktop input.
macOS and Linux process/startup behavior has automated coverage, but their
native window behavior and mixed-DPI hardware were not exercised here.
Claude HTTP failures and usage resets were replayed with synthetic provider
results; authenticated service accuracy and external rate limiting were not
tested against a live account. A clock-controlled regression covers next-day
reopening, rather than requiring a real overnight wait.

This is evidence for the tested release candidate, not a guarantee of zero
defects on every CLI version, account, display setup, or operating system.
