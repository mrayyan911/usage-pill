'use strict';

(function () {
  const pillEl = document.getElementById('pill');
  const iconEl = document.getElementById('icon');
  const barFillEl = document.getElementById('barFill');
  const barShimmerEl = document.getElementById('barShimmer');
  const percentEl = document.getElementById('percent');
  const detailEl = document.getElementById('detail');

  // 4 frames * 140ms = 560ms per walk cycle, matching the .icon.working
  // bounce animation duration in pill.css so the bounce peak lands on beat.
  const GLYPH_INTERVAL_MS = 140;

  let glyphTimer = null;
  let glyphIndex = 0;
  let currentAgent = null; // 'claude' | 'codex' | 'neutral'
  let lastState = null;

  function iconsFor(agent) {
    return window.PILL_ICONS[agent] || window.PILL_ICONS.neutral;
  }

  /** SVG sprite frames need innerHTML; plain glyph frames stay as text. */
  function setIconFrame(agent, content) {
    if (iconsFor(agent).type === 'svg') {
      iconEl.innerHTML = content;
    } else {
      iconEl.textContent = content;
    }
  }

  function stopGlyphCycle() {
    if (glyphTimer) {
      clearInterval(glyphTimer);
      glyphTimer = null;
    }
  }

  function startGlyphCycle(agent) {
    stopGlyphCycle();
    const frames = iconsFor(agent).workingFrames;
    glyphIndex = 0;
    setIconFrame(agent, frames[0]);
    glyphTimer = setInterval(() => {
      glyphIndex = (glyphIndex + 1) % frames.length;
      setIconFrame(agent, frames[glyphIndex]);
    }, GLYPH_INTERVAL_MS);
  }

  /** 260ms crossfade + 4px slide when the active agent changes. */
  function switchAgent(nextAgent, isWorking) {
    currentAgent = nextAgent;
    const icons = iconsFor(nextAgent);
    pillEl.style.setProperty('--agent-color', icons.color);
    iconEl.style.color = icons.color;
    barFillEl.style.backgroundColor = icons.color;

    iconEl.classList.add('switching');
    setTimeout(() => {
      setIconFrame(nextAgent, isWorking ? icons.workingFrames[0] : icons.idleGlyph);
      iconEl.classList.remove('switching');
      if (isWorking) startGlyphCycle(nextAgent);
    }, 150);
  }

  function thresholdClass(percent) {
    if (percent == null) return null;
    if (percent >= 90) return 'red';
    if (percent >= 75) return 'amber';
    return null;
  }

  function fmtPercent(percent) {
    if (percent == null) return '—'; // em dash
    return `${Math.round(percent)}%`;
  }

  function fmtResetsIn(resetsAtIso) {
    if (!resetsAtIso) return null;
    const ms = new Date(resetsAtIso).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return 'resets soon';
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `resets in ${h}h ${m}m`;
    return `resets in ${m}m`;
  }

  function statusNote(state) {
    switch (state.status) {
      case 'unauthenticated':
        return 'sign in to Claude Code';
      case 'stale':
        return 'connection lost — showing last known value';
      case 'error':
        return 'temporarily unavailable';
      case 'never-used':
        return 'no usage yet';
      default:
        return null;
    }
  }

  function render(state) {
    const agent = state.agent || 'neutral';
    const isWorking = state.state === 'working';
    const isBlocked = state.state === 'blocked';
    const isBusy = isWorking || isBlocked;
    const isNeutralStatus = state.status === 'unauthenticated' || state.status === 'never-used';
    const displayAgent = isNeutralStatus ? 'neutral' : agent;

    const agentChanged = displayAgent !== currentAgent;

    if (agentChanged) {
      switchAgent(displayAgent, isWorking && !isNeutralStatus);
    } else if (isWorking && !isNeutralStatus) {
      if (!glyphTimer) startGlyphCycle(displayAgent);
    } else {
      stopGlyphCycle();
      setIconFrame(displayAgent, iconsFor(displayAgent).idleGlyph);
    }

    iconEl.classList.toggle('working', isWorking && !isNeutralStatus);
    iconEl.classList.toggle('idle', !isBusy || isNeutralStatus);

    barShimmerEl.classList.toggle('active', isWorking && !isNeutralStatus);

    const percent = isNeutralStatus ? null : state.percent;
    const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
    barFillEl.style.transform = `scaleX(${clamped})`;

    const cls = thresholdClass(percent);
    barFillEl.classList.toggle('amber', cls === 'amber');
    barFillEl.classList.toggle('red', cls === 'red');
    if (cls !== 'amber' && cls !== 'red' && !agentChanged) {
      barFillEl.style.backgroundColor = iconsFor(displayAgent).color;
    } else if (cls === 'amber') {
      barFillEl.style.backgroundColor = '#E8A33D';
    } else if (cls === 'red') {
      barFillEl.style.backgroundColor = '#E5484D';
    }

    pillEl.classList.toggle('danger', cls === 'red');
    pillEl.classList.toggle('working', isWorking && !isNeutralStatus);

    percentEl.textContent = fmtPercent(percent);

    const parts = [];
    const note = statusNote(state);
    if (note) parts.push(note);
    const resetsIn = isNeutralStatus ? null : fmtResetsIn(state.resetsAt);
    if (resetsIn) parts.push(resetsIn);
    if (!isNeutralStatus && state.weeklyPercent != null) parts.push(`weekly ${Math.round(state.weeklyPercent)}%`);
    if (!isNeutralStatus && state.planType) parts.push(state.planType);
    detailEl.textContent = parts.join(' · ');

    lastState = state;
  }

  window.usagePill.onState(render);
  window.usagePill.onHover((isHovering) => {
    // Grows the pill in place (CSS grid-row morph) rather than showing a
    // separate floating tooltip -- the "dynamic island" expand.
    pillEl.classList.toggle('expanded', isHovering && !!lastState);
  });
})();
