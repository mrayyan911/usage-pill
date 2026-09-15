'use strict';

/**
 * The common "no usage data" shape both providers (HTTP for Claude, local
 * rollout scan for Codex) and the usage store return before a `status` is
 * mixed in. Shared so the same four null fields aren't hand-copied at every
 * early-return site.
 */
const EMPTY_USAGE = { percent: null, resetsAt: null, weeklyPercent: null, planType: null };

module.exports = { EMPTY_USAGE };
