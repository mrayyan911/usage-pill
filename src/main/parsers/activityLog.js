'use strict';

/**
 * Parses the append-only activity.jsonl written by the Claude Code hooks
 * (see hooks/activity-hook.js and the SETUP section of README.md).
 *
 * Each line is one of:
 *   {agent:"claude", ev:"start",        ts, session_id}
 *   {agent:"claude", ev:"end",          ts, session_id}   -- Stop
 *   {agent:"claude", ev:"end",          ts, session_id}   -- StopFailure (same shape)
 *   {agent:"claude", ev:"blocked",      ts, session_id}   -- permission_prompt Notification
 *   {agent:"claude", ev:"subagent_start", ts, session_id}
 *   {agent:"claude", ev:"subagent_stop",  ts, session_id}
 *   {agent:"claude", ev:"session_end",  ts, session_id}
 *
 * State machine: a top-level `start` enters "working" and resets subagent
 * depth. `subagent_start`/`subagent_stop` track nested work without
 * flipping the top-level state on their own -- while depth > 0 the agent
 * is working regardless of what the top-level state was. `end`,
 * `session_end` return to "idle" once depth has drained back to 0.
 * `blocked` (a permission prompt) is distinct from both: motion should
 * stop, but the turn hasn't ended.
 */
function parseActivityLog(text) {
  let state = 'idle';
  let depth = 0;
  let lastTs = null;
  let lastSessionId = null;

  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.agent !== 'claude') continue;

    lastTs = record.ts || lastTs;
    lastSessionId = record.session_id || lastSessionId;

    switch (record.ev) {
      case 'start':
        state = 'working';
        depth = 0;
        break;
      case 'subagent_start':
        depth += 1;
        state = 'working';
        break;
      case 'subagent_stop':
        depth = Math.max(0, depth - 1);
        break;
      case 'blocked':
        state = 'blocked';
        break;
      case 'end':
      case 'session_end':
        if (depth === 0) state = 'idle';
        // else: subagents still nested under this turn somehow -- keep
        // "working" rather than snapping to idle under an inconsistent log.
        break;
      default:
        break;
    }
  }

  return { state, lastTs, lastSessionId };
}

module.exports = { parseActivityLog };
