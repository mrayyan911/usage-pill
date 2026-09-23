'use strict';

class VisibilityController {
  constructor({ preview = false, onChange = () => {} } = {}) {
    this._preview = preview;
    this._paused = false;
    this._ready = false;
    this._hasSessions = false;
    this._onChange = onChange;
    this._last = '';
  }

  snapshot() {
    return { visible: this._ready && !this._paused && (this._preview || this._hasSessions), paused: this._paused, preview: this._preview };
  }

  setReady() { this._ready = true; this._publish(); }
  setSessions(agents) { this._hasSessions = agents.length > 0; this._publish(); }
  pause() { this._paused = true; this._preview = false; this._publish(); }
  resume() { this._paused = false; this._preview = false; this._publish(); }
  showPreview() { this._paused = false; this._preview = true; this._publish(); }

  _publish() {
    const state = this.snapshot();
    const json = JSON.stringify(state);
    if (json === this._last) return;
    this._last = json;
    this._onChange(state);
  }
}

module.exports = { VisibilityController };
