'use strict';

const { execSync } = require('node:child_process');

/**
 * One-shot liveness check via `tasklist`, used ONLY to arbitrate a stale
 * "working" reading (transcript/log frozen past the staleness threshold).
 * Callers must rate-limit this themselves (design: max once per 10s) --
 * spawning tasklist is comparatively expensive and low-value as a primary
 * signal (both CLIs are network-IO-bound while genuinely working, so CPU%
 * is a poor discriminator; this is a coarse "is the process even still
 * there" check, nothing more).
 */
function isProcessRunning(imageName) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, {
      timeout: 3000,
      windowsHide: true,
    }).toString();
    return out.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    // tasklist failing (permissions, timeout) should not itself force an
    // idle verdict -- treat as "can't tell", caller keeps prior state.
    return null;
  }
}

module.exports = { isProcessRunning };
