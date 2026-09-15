'use strict';

const { fetchClaudeUsage } = require('../providers/claude');
const { readCodexSnapshot } = require('../providers/codex');
const { EMPTY_USAGE } = require('../usageShape');

const CLAUDE_POLL_MS = 60_000;
const CLAUDE_EDGE_DEBOUNCE_MS = 5_000;
const HTTP_ERROR_BACKOFF_START_MS = 60_000;
const HTTP_ERROR_BACKOFF_MAX_MS = 120_000;
const STALE_AFTER_MS = 3 * 60_000;

/**
 * Owns the Claude 5-hour usage percentage (fetched over HTTP) and the
 * Codex usage percentage (read from local rollout files, effectively
 * free). Claude polls on a fixed 60s cadence plus an edge-triggered
 * refetch when a turn just finished (percent only moves when a turn
 * completes, so there's no point polling faster than that in general,
 * but the edge makes the number catch up promptly right when it changes).
 */
class UsageStore {
  constructor({ now = () => Date.now() } = {}) {
    this._now = now;
    this._claude = { ...EMPTY_USAGE, status: 'error', lastFetchedAt: 0, lastGoodAt: 0 };
    this._codex = { ...EMPTY_USAGE, status: 'error', lastFetchedAt: 0, lastGoodAt: 0 };
    this._claudeBackoffMs = HTTP_ERROR_BACKOFF_START_MS;
    this._pendingEdgeRefetch = null;
    this._inFlight = false;
  }

  /** Codex usage rides the same local-file scan the activity store uses; cheap, called freely. */
  refreshCodex() {
    const snapshot = readCodexSnapshot();
    const now = this._now();
    if (snapshot.usage.status === 'ok') {
      this._codex = { ...snapshot.usage, status: 'ok', lastFetchedAt: now, lastGoodAt: now };
    } else if (this._codex.lastGoodAt === 0) {
      // Never had a good reading (Codex never used, or no rate_limits yet) --
      // reflect that plainly rather than a stale placeholder.
      this._codex = { ...EMPTY_USAGE, status: snapshot.usage.status, lastFetchedAt: now, lastGoodAt: 0 };
    } else {
      this._codex = { ...this._codex, status: this._staleOrError(this._codex.lastGoodAt, now) };
    }
    return this.getCodexUsage();
  }

  async _refreshClaude() {
    if (this._inFlight) return;
    this._inFlight = true;
    try {
      const result = await fetchClaudeUsage();
      const now = this._now();
      if (result.status === 'ok') {
        this._claude = { ...result, lastFetchedAt: now, lastGoodAt: now };
        this._claudeBackoffMs = HTTP_ERROR_BACKOFF_START_MS;
      } else if (result.status === 'unauthenticated') {
        this._claude = { ...EMPTY_USAGE, status: 'unauthenticated', lastFetchedAt: now, lastGoodAt: 0 };
      } else {
        this._claudeBackoffMs = Math.min(this._claudeBackoffMs * 2, HTTP_ERROR_BACKOFF_MAX_MS);
        this._claude = {
          ...this._claude,
          status: this._claude.lastGoodAt === 0 ? 'error' : this._staleOrError(this._claude.lastGoodAt, now),
          lastFetchedAt: now,
        };
      }
    } finally {
      this._inFlight = false;
    }
  }

  _staleOrError(lastGoodAt, now) {
    return now - lastGoodAt > STALE_AFTER_MS ? 'stale' : 'ok';
  }

  /**
   * Called on every activity tick (~400ms) so the store can decide, cheaply,
   * whether it's time to hit the network. `claudeWorkingEdge` should be
   * true exactly once, the tick after Claude's activity flips working/blocked -> idle.
   */
  maybeRefreshClaude(claudeWorkingEdge) {
    const now = this._now();
    const dueByCadence = now - this._claude.lastFetchedAt >= this._claudeBackoffPollInterval();
    const dueByEdge = claudeWorkingEdge && now - this._claude.lastFetchedAt >= CLAUDE_EDGE_DEBOUNCE_MS;

    if (dueByCadence || dueByEdge) {
      // Fire and forget; getClaudeUsage() reflects the result once it lands.
      void this._refreshClaude();
    }
  }

  _claudeBackoffPollInterval() {
    return this._claude.status === 'unauthenticated' ? this._claudeBackoffMs : Math.max(CLAUDE_POLL_MS, this._claudeBackoffMs);
  }

  getClaudeUsage() {
    const { percent, resetsAt, weeklyPercent, planType, status } = this._claude;
    return { agent: 'claude', percent, resetsAt, weeklyPercent, planType, status };
  }

  getCodexUsage() {
    const { percent, resetsAt, weeklyPercent, planType, status } = this._codex;
    return { agent: 'codex', percent, resetsAt, weeklyPercent, planType, status };
  }
}

module.exports = { UsageStore, CLAUDE_POLL_MS };
