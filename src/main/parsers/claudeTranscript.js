'use strict';

/**
 * Parses a Claude Code session transcript (.jsonl) to determine whether the
 * agent is currently mid-turn.
 *
 * Ground truth, verified against real transcripts on 2026-09-14:
 *   - `assistant` records carry `message.stop_reason`:
 *       "tool_use"  -> a tool is executing / about to execute -> WORKING
 *       "end_turn"  -> the turn finished                       -> IDLE
 *       anything else (max_tokens, refusal, stop_sequence)     -> IDLE
 *   - `user` records with a `tool_result` content block mean Claude is
 *     waiting on the model for the next step -> WORKING.
 *   - `user` records with a plain `text` block and no `isMeta` flag mean a
 *     prompt was just submitted and hasn't been answered yet -> WORKING.
 *   - A family of sidecar record types carry NO `timestamp` and are written
 *     at the *end* of a turn (last-prompt, ai-title, mode, permission-mode,
 *     atis-latch, file-history-snapshot, queue-operation, system, and the
 *     `attachment` record whose attachment.type is prompt_snapshot). These
 *     must be ignored entirely for activity purposes -- keying off their
 *     mtime is a guaranteed false positive.
 */

const IGNORED_TYPES = new Set([
  'last-prompt',
  'ai-title',
  'mode',
  'permission-mode',
  'atis-latch',
  'file-history-snapshot',
  'queue-operation',
  'system',
]);

/**
 * @param {string} text raw contents of a transcript .jsonl (or a tail slice of one)
 * @returns {'working'|'idle'|'unknown'}
 */
function parseClaudeActivity(text) {
  const lines = text.split('\n');
  // Walk backwards; skip the first fragment of a tail-read (it may be a
  // truncated line with no leading newline before it).
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // Truncated leading fragment from a tail read, or corrupt line -- skip.
      continue;
    }

    if (record.type === 'attachment') {
      // prompt_snapshot and friends are end-of-turn sidecars; nothing else
      // under `attachment` carries turn-state signal either.
      continue;
    }
    if (IGNORED_TYPES.has(record.type)) continue;

    if (record.type === 'assistant') {
      const stopReason = record.message && record.message.stop_reason;
      if (stopReason === 'tool_use') return 'working';
      if (stopReason === 'end_turn') return 'idle';
      // max_tokens / refusal / stop_sequence / anything unrecognized: the
      // turn is over even though it didn't end cleanly.
      if (stopReason != null) return 'idle';
      continue;
    }

    if (record.type === 'user') {
      const content = record.message && record.message.content;
      if (Array.isArray(content)) {
        if (content.some((c) => c && c.type === 'tool_result')) return 'working';
        if (!record.isMeta && content.some((c) => c && c.type === 'text')) {
          return 'working';
        }
      }
      continue;
    }

    // Any other record type with no recognized signal: keep scanning backward.
  }
  return 'unknown';
}

module.exports = { parseClaudeActivity, IGNORED_TYPES };
