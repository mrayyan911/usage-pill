'use strict';

const fs = require('node:fs');
const path = require('node:path');

function positionFilePath() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || require('node:os').homedir();
  return path.join(base, 'usage-pill', 'position.json');
}

/**
 * Persists where the user last dragged the pill so it can reopen there.
 * Reads/writes are synchronous: this only runs at launch and at drag-end
 * (already debounced by window.js's existing drag-idle timer), not on a
 * hot path.
 */
class PositionStore {
  static load() {
    let raw;
    try {
      raw = fs.readFileSync(positionFilePath(), 'utf8');
    } catch {
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const { x, y, displayId } = parsed;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof displayId !== 'number') return null;
    return { x, y, displayId };
  }

  static save({ x, y, displayId }) {
    const filePath = positionFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ x, y, displayId }));
  }
}

module.exports = { PositionStore, positionFilePath };
