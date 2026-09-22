'use strict';

(function () {
  const pillEl = document.getElementById('pill');
  const collapsedRowEl = document.getElementById('collapsedRow');
  const agentRowsEl = document.getElementById('agentRows');
  const detailEl = document.getElementById('detail');

  let lastState = null;
  // Persistent per-agent-identity DOM refs, reused across ticks so an
  // in-place percent/state update never restarts a running CSS animation
  // (working pulse, shimmer sweep) -- a node is only rebuilt when the
  // agent it represents actually stops being shown. Reordering two
  // still-shown agents (which agent's row order flips) moves the existing
  // nodes via insertBefore instead of recreating them, since a keyed-only
  // reconciliation was still order-sensitive and could destroy both rows
  // on every tick while both agents were simultaneously busy.
  let collapsed = []; // [{ agentKey, el }]
  let rows = []; // [{ agentKey, el, badgeEl, fillEl, shimmerEl, percentEl }]

  function iconsFor(agentKey) {
    return window.PILL_ICONS[agentKey] || window.PILL_ICONS.neutral;
  }

  function keyOf(row) {
    return row.agent || 'neutral';
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

  function statusNote(row) {
    switch (row.status) {
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

  /** Short stand-in for the percent cell itself, when there's no number to show yet. */
  function statusWord(row) {
    switch (row.status) {
      case 'unauthenticated':
        return 'sign in';
      case 'error':
        return 'offline';
      case 'stale':
        return 'stale';
      default:
        return null;
    }
  }

  function makeIconEl(agentKey, sizeClass) {
    const icons = iconsFor(agentKey);
    const el = document.createElement('span');
    el.className = `agent-icon ${sizeClass}`;
    el.dataset.agent = agentKey;
    if (icons.createMarkup) el.innerHTML = icons.createMarkup();
    else el.textContent = icons.glyph;
    return el;
  }

  /**
   * Keyed reconciliation: reuses an existing DOM node when its agent is
   * still shown, even if its position changed, builds a fresh node only
   * for an agent that just started being shown, and removes nodes for
   * agents no longer shown. Existing nodes are repositioned via
   * insertBefore rather than removed+readded, which does not interrupt
   * their running CSS animations -- a purely order-sensitive key (e.g.
   * comparing agent arrays by position) would treat every reorder as a
   * full identity change and rebuild both rows, restarting their pulse/
   * shimmer animations every tick two agents are simultaneously busy.
   */
  function reorderByKey(containerEl, controllers, desiredKeys, buildFn) {
    const byKey = new Map(controllers.map((c) => [c.agentKey, c]));
    const next = desiredKeys.map((key) => byKey.get(key) || buildFn(key));

    next.forEach((controller, i) => {
      if (containerEl.children[i] !== controller.el) {
        containerEl.insertBefore(controller.el, containerEl.children[i] || null);
      }
    });

    const nextKeys = new Set(desiredKeys);
    controllers.forEach((c) => {
      if (!nextKeys.has(c.agentKey)) c.el.remove();
    });

    return next;
  }

  function reconcileCollapsed(rowStates) {
    const keys = rowStates.map(keyOf);
    collapsed = reorderByKey(collapsedRowEl, collapsed, keys, (agentKey) => ({
      agentKey,
      el: makeIconEl(agentKey, 'collapsed'),
    }));
    collapsed.forEach((c, i) => {
      const working = rowStates[i].state === 'working';
      c.el.classList.toggle('working', working);
      c.el.classList.toggle('idle', !working);
    });
  }

  function buildAgentRow(agentKey) {
    const el = document.createElement('div');
    el.className = 'agent-row';
    el.style.setProperty('--row-color', iconsFor(agentKey).color);

    const badgeEl = document.createElement('div');
    badgeEl.className = 'badge';
    badgeEl.appendChild(makeIconEl(agentKey, 'badge-icon'));

    const trackEl = document.createElement('div');
    trackEl.className = 'bar-track';
    const fillEl = document.createElement('div');
    fillEl.className = 'bar-fill';
    const shimmerEl = document.createElement('div');
    shimmerEl.className = 'bar-shimmer';
    trackEl.appendChild(fillEl);
    trackEl.appendChild(shimmerEl);

    const percentEl = document.createElement('div');
    percentEl.className = 'percent';

    el.appendChild(badgeEl);
    el.appendChild(trackEl);
    el.appendChild(percentEl);

    return { agentKey, el, badgeEl, fillEl, shimmerEl, percentEl };
  }

  function reconcileAgentRows(rowStates) {
    const keys = rowStates.map(keyOf);
    rows = reorderByKey(agentRowsEl, rows, keys, buildAgentRow);

    let anyWorking = false;
    let anyDanger = false;

    rows.forEach((r, i) => {
      const row = rowStates[i];
      const working = row.state === 'working';
      if (working) anyWorking = true;

      const word = statusWord(row);
      r.percentEl.textContent = word || fmtPercent(row.percent);
      r.percentEl.classList.toggle('percent-status', !!word);

      const clamped = row.percent == null ? 0 : Math.max(0, Math.min(100, row.percent)) / 100;
      r.fillEl.style.transform = `scaleX(${clamped})`;

      const cls = thresholdClass(row.percent);
      r.fillEl.classList.toggle('amber', cls === 'amber');
      r.fillEl.classList.toggle('red', cls === 'red');
      if (cls === 'red') anyDanger = true;

      r.shimmerEl.classList.toggle('active', working);
      r.badgeEl.classList.toggle('working', working);
    });

    return { anyWorking, anyDanger };
  }

  function renderDetail(rowStates) {
    if (rowStates.length !== 1) {
      detailEl.textContent = '';
      return;
    }
    const [row] = rowStates;
    const parts = [];
    const note = statusNote(row);
    if (note) parts.push(note);
    const resetsIn = fmtResetsIn(row.resetsAt);
    if (resetsIn) parts.push(resetsIn);
    if (row.weeklyPercent != null) parts.push(`weekly ${Math.round(row.weeklyPercent)}%`);
    if (row.planType) parts.push(row.planType);
    detailEl.textContent = parts.join(' · ');
  }

  function render(state) {
    const rowStates =
      state.agents && state.agents.length
        ? state.agents
        : [{ agent: null, percent: null, resetsAt: null, weeklyPercent: null, planType: null, state: 'idle', status: 'never-used' }];

    pillEl.classList.toggle('agents-2', rowStates.length === 2);
    pillEl.classList.toggle('agents-1', rowStates.length === 1);

    reconcileCollapsed(rowStates);
    const { anyWorking, anyDanger } = reconcileAgentRows(rowStates);

    pillEl.classList.toggle('working', anyWorking);
    pillEl.classList.toggle('danger', anyDanger);

    renderDetail(rowStates);

    lastState = state;
  }

  window.usagePill.onState(render);
  window.usagePill.onHover((isHovering) => {
    // Grows the pill in place (CSS grid-row morph) rather than showing a
    // separate floating tooltip -- the "dynamic island" expand.
    pillEl.classList.toggle('expanded', isHovering && !!lastState);
  });
})();
