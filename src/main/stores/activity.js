'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readTail, statOrNull } = require('../fsUtil');
const { parseActivityLog } = require('../parsers/activityLog');
const { listCandidateTranscripts, readClaudeActivityFromTranscripts } = require('../providers/claudeActivity');
const { readCodexSnapshot } = require('../providers/codex');
const { isProcessRunning } = require('../processCheck');

const STALE_MS = 180_000; // measured floor: a real single tool call spanned 2m8s with zero writes
const PROCESS_PROBE_MIN_INTERVAL_MS = 10_000;

function activityLogPath() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || require('node:os').homedir();
  return path.join(base, 'usage-pill', 'activity.jsonl');
}

/**
 * Claude activity: prefer the hook-written activity.jsonl when it exists
 * (installed by hooks/activity-hook.js via ~/.claude/settings.json) --
 * it distinguishes "blocked on a permission prompt" from "tool running",
 * which the transcript alone cannot. Fall back to transcript-tail scanning
 * for sessions that predate the hooks, or if hooks are disabled.
 *
 * The log outlives its hooks: once they're removed from settings.json it is
 * never written again, and its final `session_end` would pin Claude to idle
 * forever. So it only counts for the session it describes (transcripts are
 * named <session_id>.jsonl) or when it's newer than the newest transcript --
 * the permission-prompt case, where the hook writes and the transcript doesn't.
 */
function readClaudeState() {
  const logPath = activityLogPath();
  const logStat = statOrNull(logPath);
  if (logStat) {
    let text;
    try {
      text = readTail(logPath, 16 * 1024); // small append-only file; 16KB tail is generous
    } catch {
      text = '';
    }
    const { state, lastTs, lastSessionId } = parseActivityLog(text);
    const newestTranscript = listCandidateTranscripts()[0];
    const describesNewestSession = newestTranscript != null
      && path.basename(newestTranscript.filePath, '.jsonl') === lastSessionId;
    const newerThanTranscript = newestTranscript == null || logStat.mtimeMs >= newestTranscript.mtimeMs;
    if (lastTs != null && (describesNewestSession || newerThanTranscript)) {
      return { state, mtimeMs: logStat.mtimeMs, source: 'hook' };
    }
  }
  const fallback = readClaudeActivityFromTranscripts();
  return { state: fallback.state === 'unknown' ? 'idle' : fallback.state, mtimeMs: fallback.mtimeMs, source: 'transcript' };
}

/**
 * Reuses the single combined Codex scan (see providers/codex.js) so
 * activity and usage never cost two separate file reads. The usage store
 * calls readCodexSnapshot() again on its own cadence -- cheap local reads,
 * unlike Claude's HTTP call -- so duplicating the call there is fine.
 */
function readCodexState() {
  const snapshot = readCodexSnapshot();
  return {
    state: snapshot.activity === 'unknown' ? 'idle' : snapshot.activity,
    mtimeMs: snapshot.newestMtimeMs,
    source: 'rollout',
  };
}

/**
 * Tracks state across polls so it can apply the staleness+process-probe
 * arbitration (a "working" reading frozen past STALE_MS with no live
 * process is forced to idle) without re-probing on every 400ms tick.
 */
class ActivityStore {
  constructor() {
    this._workingSince = { claude: null, codex: null }; // ms epoch, first tick we saw 'working'/'blocked' at this mtime
    this._lastMtimeSeen = { claude: null, codex: null };
    this._lastProcessProbe = { claude: 0, codex: 0 };
    this._lastKnownState = { claude: 'idle', codex: 'idle' };
    this._stickyActive = null; // 'claude' | 'codex' | null -- see poll()
  }

  _arbitrate(agent, raw, imageNames) {
    const now = Date.now();
    const { state, mtimeMs } = raw;

    if (mtimeMs != null && mtimeMs !== this._lastMtimeSeen[agent]) {
      // Fresh write: reset the staleness clock, trust the raw state.
      this._lastMtimeSeen[agent] = mtimeMs;
      this._workingSince[agent] = state === 'working' || state === 'blocked' ? now : null;
      this._lastKnownState[agent] = state;
      return state;
    }

    // No change since last tick. If we're not in a busy state, nothing to arbitrate.
    if (state !== 'working' && state !== 'blocked') {
      this._lastKnownState[agent] = state;
      return state;
    }

    if (this._workingSince[agent] == null) this._workingSince[agent] = now;
    const frozenFor = now - this._workingSince[agent];
    if (frozenFor < STALE_MS) {
      this._lastKnownState[agent] = state;
      return state;
    }

    // Stuck busy for longer than any observed real tool call: probe once,
    // rate-limited, whether the process is even still around.
    if (now - this._lastProcessProbe[agent] >= PROCESS_PROBE_MIN_INTERVAL_MS) {
      this._lastProcessProbe[agent] = now;
      const alive = imageNames.some((name) => isProcessRunning(name) === true);
      if (!alive) {
        this._lastKnownState[agent] = 'idle';
        return 'idle';
      }
    }
    // Process check inconclusive or still alive: keep reporting the busy
    // state rather than flicker, but don't reset the staleness clock.
    this._lastKnownState[agent] = state;
    return state;
  }

  /**
   * @returns {{active:'claude'|'codex'|null, state:'working'|'blocked'|'idle'}}
   */
  poll() {
    const claudeRaw = readClaudeState();
    const codexRaw = readCodexState();

    const claudeState = this._arbitrate('claude', claudeRaw, ['claude.exe', 'node.exe']);
    const codexState = this._arbitrate('codex', codexRaw, ['codex.exe']);

    const claudeMtime = claudeRaw.mtimeMs ?? -Infinity;
    const codexMtime = codexRaw.mtimeMs ?? -Infinity;
    const isBusy = (state) => state === 'working' || state === 'blocked';

    let active;
    if (claudeMtime === -Infinity && codexMtime === -Infinity) {
      active = null;
    } else if (this._stickyActive && isBusy(this._stickyActive === 'claude' ? claudeState : codexState)) {
      // Sticky on purpose: when both agents are busy at once, each one's
      // backing file gets touched independently, so raw mtime comparison
      // can flip which one is "newer" almost every tick. Reduce.js orders
      // its two-row output by `active`, so an unstuck flip-flop here would
      // reorder both agent rows every ~400ms -- and the renderer key on
      // that order previously destroyed/rebuilt both rows every time,
      // restarting their CSS animations. Keeping the current active agent
      // pinned while it's still busy means order only changes on a real
      // handoff (the active agent actually going idle).
      active = this._stickyActive;
    } else if (isBusy(claudeState) !== isBusy(codexState)) {
      // Exactly one agent is busy: prefer it outright. A working -> idle
      // transition is itself usually a fresh write (e.g. the hook log's
      // "stop" line), so on a handoff the agent that just finished can
      // transiently out-mtime the other agent that's still working --
      // raw mtime comparison would then pick the wrong (idle) agent for
      // one tick.
      active = isBusy(claudeState) ? 'claude' : 'codex';
    } else {
      active = claudeMtime >= codexMtime ? 'claude' : 'codex';
    }
    this._stickyActive = active;

    return {
      active,
      state: active === 'claude' ? claudeState : active === 'codex' ? codexState : 'idle',
      claude: claudeState,
      codex: codexState,
    };
  }
}

module.exports = { ActivityStore, activityLogPath };
