'use strict';

const { readWindowsProcesses } = require('../providers/windowsProcesses');
const { readSessions } = require('../parsers/processSessions');

class SessionStore {
  constructor({ readProcesses = readWindowsProcesses, intervalMs = 1000 } = {}) {
    this._readProcesses = readProcesses;
    this._intervalMs = intervalMs;
    this._sessions = [];
    this._status = 'unknown';
    this._pending = null;
    this._timer = null;
    this._abort = null;
    this._onChange = null;
  }

  getSnapshot() {
    return { agents: [...new Set(this._sessions.map(s => s.agent))], status: this._status };
  }

  poll() {
    if (this._pending) return this._pending;
    this._abort = new AbortController();
    const signal = this._abort.signal;
    this._pending = (async () => {
      try {
        const rows = await this._readProcesses({ signal });
        if (signal.aborted) return;
        this._sessions = readSessions(rows, this._sessions);
        this._status = 'ok';
      } catch {
        if (signal.aborted) return;
        this._status = 'error';
      } finally {
        this._pending = null;
      }
      this._onChange?.(this.getSnapshot());
    })();
    return this._pending;
  }

  start(onChange) {
    if (this._timer) return;
    this._onChange = onChange;
    this._timer = setInterval(() => void this.poll(), this._intervalMs);
    void this.poll();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._onChange = null;
    this._abort?.abort();
  }
}

module.exports = { SessionStore };
