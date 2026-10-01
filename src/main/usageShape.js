'use strict';

/**
 * The common "no usage data" shape both providers (HTTP for Claude, local
 * rollout scan for Codex) and the usage store return before a `status` is
 * mixed in. Shared so the same four null fields aren't hand-copied at every
 * early-return site.
 */
const EMPTY_USAGE = { percent: null, resetsAt: null, weeklyPercent: null, planType: null };

function currentUsage(usage, now) {
  const expired = usage.resetsAt != null && new Date(usage.resetsAt).getTime() <= now;
  const weeklyExpired = usage.weeklyResetsAt != null && new Date(usage.weeklyResetsAt).getTime() <= now;
  return {
    ...usage,
    ...(expired ? { percent: null, resetsAt: null, status: 'stale' } : {}),
    ...(weeklyExpired ? { weeklyPercent: null, weeklyResetsAt: null } : {}),
  };
}

module.exports = { EMPTY_USAGE, currentUsage };
