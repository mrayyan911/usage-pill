'use strict';

/**
 * Parses a Codex rollout transcript (.jsonl) for both usage (`rate_limits`)
 * and activity (`task_started` / `task_complete`) in a single backward scan.
 *
 * Ground truth, verified against real rollout files on 2026-09-14:
 *   - Every rollout file opens with a `session_meta` record. Its payload
 *     carries `parent_thread_id` (null for the user's own root thread, a
 *     thread id when this file is a subagent) and `thread_source`
 *     ("user" for the root thread; "guardian_review" etc for subagents).
 *   - `rate_limits` rides on `event_msg` records whose payload.type is
 *     "token_count". A subagent's rate_limits reflect a stale/partial
 *     snapshot and must NOT be used for the usage percentage -- only a
 *     root/user thread's rate_limits are authoritative.
 *   - `task_started` / `task_complete` share a `turn_id`. A `task_started`
 *     with no later matching `task_complete` means the turn is in flight.
 *     ~11% of turns never emit `task_complete` (crash/abort), so callers
 *     must apply a staleness timeout on top of this signal.
 *   - Activity should be evaluated across ALL rollout files including
 *     subagents (a running subagent means Codex is genuinely working);
 *     usage should only ever be read from a root/user thread file.
 */

/**
 * @param {string} text raw contents of a rollout .jsonl (or a tail slice)
 * @returns {{
 *   isUserThread: boolean,
 *   rateLimits: object|null,
 *   activity: 'working'|'idle'|'unknown'
 * }}
 */
function parseCodexRollout(text) {
  const lines = text.split('\n');

  let isUserThread = false;
  let sawSessionMeta = false;
  let rateLimits = null;
  const started = new Map(); // turn_id -> true
  const completed = new Set(); // turn_id

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === 'session_meta' && !sawSessionMeta) {
      sawSessionMeta = true;
      const payload = record.payload || {};
      isUserThread = payload.parent_thread_id == null && payload.thread_source === 'user';
      continue;
    }

    if (record.type !== 'event_msg' || !record.payload) continue;
    const payload = record.payload;

    if (payload.type === 'task_started' && payload.turn_id) {
      started.set(payload.turn_id, true);
    } else if (payload.type === 'task_complete' && payload.turn_id) {
      completed.add(payload.turn_id);
    } else if (payload.type === 'token_count' && payload.rate_limits) {
      // Keep the LAST one seen (we're iterating forward here, so this
      // naturally ends up holding the most recent).
      rateLimits = payload.rate_limits;
    }
  }

  let activity = 'unknown';
  if (started.size > 0) {
    let anyInFlight = false;
    for (const turnId of started.keys()) {
      if (!completed.has(turnId)) {
        anyInFlight = true;
        break;
      }
    }
    activity = anyInFlight ? 'working' : 'idle';
  }

  return { isUserThread, rateLimits, activity };
}

module.exports = { parseCodexRollout };
