'use strict';

/**
 * Pure merge of an ActivityStore.poll() snapshot with the two UsageStore
 * getters into the single shape the renderer consumes. Kept separate from
 * the timers/IO in index.js so it's trivially unit-testable.
 *
 * Open sessions determine which rows exist, independently of turn activity.
 * Without session data, manual preview preserves the prior activity-based
 * selection. `primary` stays the busier/most
 * recently touched agent (ActivityStore's own mtime tie-break), used by the
 * renderer for the collapsed pill's ambient glow color and row ordering.
 *
 * @param {{active:'claude'|'codex'|null, claude:string, codex:string}} activitySnapshot
 * @param {object} claudeUsage from UsageStore.getClaudeUsage()
 * @param {object} codexUsage from UsageStore.getCodexUsage()
 * @returns {{agents:Array<{agent:string|null,percent:number|null,resetsAt:string|null,
 *   weeklyPercent:number|null,planType:string|null,state:string,status:string}>,
 *   primary:'claude'|'codex'|null}}
 */
function reduce({ activitySnapshot, claudeUsage, codexUsage, sessionAgents }) {
  const { claude: claudeState, codex: codexState } = activitySnapshot;
  const active = sessionAgents
    ? sessionAgents.includes(activitySnapshot.active) ? activitySnapshot.active : sessionAgents[0] || null
    : activitySnapshot.active;

  if (!active) {
    return {
      agents: [
        {
          agent: null,
          percent: null,
          resetsAt: null,
          weeklyPercent: null,
          planType: null,
          state: 'idle',
          status: 'never-used',
        },
      ],
      primary: null,
    };
  }

  const entry = (agent, usage, state) => ({
    agent,
    percent: usage.percent,
    resetsAt: usage.resetsAt instanceof Date ? usage.resetsAt.toISOString() : usage.resetsAt,
    weeklyPercent: usage.weeklyPercent,
    planType: usage.planType,
    state,
    status: usage.status,
  });

  const claudeEntry = entry('claude', claudeUsage, claudeState);
  const codexEntry = entry('codex', codexUsage, codexState);
  const isBusy = (state) => state === 'working' || state === 'blocked';

  if (sessionAgents) {
    const order = [active, ...sessionAgents.filter(agent => agent !== active)];
    return { agents: order.map(agent => agent === 'claude' ? claudeEntry : codexEntry), primary: active };
  }

  const agents =
    isBusy(claudeState) && isBusy(codexState)
      ? active === 'claude'
        ? [claudeEntry, codexEntry]
        : [codexEntry, claudeEntry]
      : [active === 'claude' ? claudeEntry : codexEntry];

  return { agents, primary: active };
}

/**
 * Orchestrates the poll cadence described in the design: a fast local tick
 * for activity (~400ms), Claude's HTTP usage on its own slower/backoff
 * cadence with an edge-triggered refetch, and Codex usage riding the same
 * cheap local reads as its activity check. Pushes to `onChange` only when
 * the reduced state actually differs from what was last sent.
 */
class Reducer {
  constructor({ activityStore, usageStore, sessionStore, preview = () => false, onChange, tickMs = 400 }) {
    this._activityStore = activityStore;
    this._usageStore = usageStore;
    this._sessionStore = sessionStore;
    this._preview = preview;
    this._onChange = onChange;
    this._tickMs = tickMs;
    this._timer = null;
    this._lastSentJson = null;
    this._prevClaudeState = 'idle';
    this._prevCodexState = 'idle';
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this._tickMs);
    this._tick();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    const activitySnapshot = this._activityStore.poll();

    const claudeEdge = this._isBusyToIdleEdge(this._prevClaudeState, activitySnapshot.claude);
    this._prevClaudeState = activitySnapshot.claude;
    this._prevCodexState = activitySnapshot.codex;

    this._usageStore.maybeRefreshClaude(claudeEdge);
    this._usageStore.refreshCodex(); // cheap local reads; no separate schedule needed

    const sessions = this._sessionStore?.getSnapshot().agents;
    const state = reduce({
      activitySnapshot,
      claudeUsage: this._usageStore.getClaudeUsage(),
      codexUsage: this._usageStore.getCodexUsage(),
      sessionAgents: this._preview() && !sessions?.length ? undefined : sessions,
    });

    const json = JSON.stringify(state);
    if (json !== this._lastSentJson) {
      this._lastSentJson = json;
      this._onChange(state);
    }
  }

  _isBusyToIdleEdge(prev, next) {
    return (prev === 'working' || prev === 'blocked') && next === 'idle';
  }
}

module.exports = { reduce, Reducer };
