'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture() {
  const filename = path.resolve(__dirname, '../src/main/stores/activity.js');
  const localRequire = createRequire(filename);
  const inputs = {
    claude: { state: 'idle', mtimeMs: null },
    codex: { activity: 'idle', newestMtimeMs: null },
    hookLog: null,
  };
  const dependencies = {
    '../fsUtil': {
      statOrNull: () => (inputs.hookLog ? { mtimeMs: inputs.hookLog.mtimeMs } : null),
      readTail: () => inputs.hookLog.text,
    },
    '../providers/claudeActivity': {
      readClaudeActivityFromTranscripts: () => inputs.claude,
      listCandidateTranscripts: () => (inputs.claude.filePath ? [{ filePath: inputs.claude.filePath, mtimeMs: inputs.claude.mtimeMs }] : []),
    },
    '../providers/codex': { readCodexSnapshot: () => inputs.codex },
    '../processCheck': { isProcessRunning: () => true },
  };
  const context = {
    module: { exports: {} }, process,
    require: name => dependencies[name] || localRequire(name),
  };
  // Isolate providers without changing the shared CommonJS cache or reading real sessions.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { inputs, store: new context.module.exports.ActivityStore() };
}

test('activity: missing sources remain neutral, equal timestamps favor Claude', () => {
  const { inputs, store } = fixture();
  assert.equal(store.poll().active, null);
  inputs.claude.mtimeMs = 100;
  inputs.codex.newestMtimeMs = 100;
  assert.equal(store.poll().active, 'claude');
});

for (const primary of ['claude', 'codex']) {
  test(`activity: ${primary} stays first across concurrent writes and blocking, then hands off`, () => {
    const { inputs, store } = fixture();
    inputs.claude = { state: 'working', mtimeMs: primary === 'claude' ? 200 : 100 };
    inputs.codex = { activity: 'working', newestMtimeMs: primary === 'codex' ? 200 : 100 };
    assert.equal(store.poll().active, primary);

    const secondary = primary === 'claude' ? 'codex' : 'claude';
    const stateKey = primary === 'claude' ? 'state' : 'activity';
    const secondaryMtimeKey = secondary === 'claude' ? 'mtimeMs' : 'newestMtimeMs';
    inputs[secondary][secondaryMtimeKey] = 300;
    assert.equal(store.poll().active, primary, 'newer writes must not swap busy rows');
    inputs[primary][stateKey] = 'blocked';
    const blocked = store.poll();
    assert.equal(blocked.active, primary);
    assert.equal(blocked.state, 'blocked');
    assert.equal(blocked[secondary], 'working');

    inputs[primary][stateKey] = 'idle';
    const handedOff = store.poll();
    assert.equal(handedOff.active, secondary);
    assert.equal(handedOff.state, 'working');
    assert.equal(handedOff[primary], 'idle');
  });
}

for (const primary of ['claude', 'codex']) {
  test(`activity: ${primary} finishing (its own "stop" write bumps its mtime) must not steal active from the still-busy agent`, () => {
    const { inputs, store } = fixture();
    inputs.claude = { state: 'working', mtimeMs: primary === 'claude' ? 200 : 100 };
    inputs.codex = { activity: 'working', newestMtimeMs: primary === 'codex' ? 200 : 100 };
    assert.equal(store.poll().active, primary);

    const secondary = primary === 'claude' ? 'codex' : 'claude';
    const stateKey = primary === 'claude' ? 'state' : 'activity';
    const primaryMtimeKey = primary === 'claude' ? 'mtimeMs' : 'newestMtimeMs';

    // A real handoff: the primary's own idle-transition write both flips its
    // state AND bumps its mtime past the still-busy secondary's.
    inputs[primary][stateKey] = 'idle';
    inputs[primary][primaryMtimeKey] = 500;
    const handedOff = store.poll();
    assert.equal(handedOff.active, secondary);
    assert.equal(handedOff[secondary], 'working');
    assert.equal(handedOff[primary], 'idle');
  });
}

function hookLine(ev, sessionId, ts) {
  return `${JSON.stringify({ agent: 'claude', ev, ts, session_id: sessionId })}\n`;
}

test('activity: a leftover hook log from an old session never overrides a live transcript', () => {
  const { inputs, store } = fixture();
  inputs.hookLog = { mtimeMs: 100, text: hookLine('start', 'old-session', '2026-01-01T00:00:00.000Z') + hookLine('session_end', 'old-session', '2026-01-01T00:01:00.000Z') };
  inputs.claude = { state: 'working', mtimeMs: 900, filePath: path.join('projects', 'p', 'live-session.jsonl') };
  const snapshot = store.poll();
  assert.equal(snapshot.claude, 'working');
  assert.equal(snapshot.active, 'claude');
});

test('activity: the hook log still wins for its own session, where it alone can see a permission prompt', () => {
  const { inputs, store } = fixture();
  inputs.hookLog = { mtimeMs: 500, text: hookLine('start', 'live-session', '2026-01-01T00:00:00.000Z') + hookLine('blocked', 'live-session', '2026-01-01T00:00:05.000Z') };
  inputs.claude = { state: 'working', mtimeMs: 900, filePath: path.join('projects', 'p', 'live-session.jsonl') };
  assert.equal(store.poll().claude, 'blocked');
});

test('activity: a hook log written after the newest transcript is trusted even for another session', () => {
  const { inputs, store } = fixture();
  inputs.hookLog = { mtimeMs: 900, text: hookLine('blocked', 'other-session', '2026-01-01T00:00:05.000Z') };
  inputs.claude = { state: 'working', mtimeMs: 500, filePath: path.join('projects', 'p', 'live-session.jsonl') };
  assert.equal(store.poll().claude, 'blocked');
});

test('activity: losing both sources clears sticky selection before another agent appears', () => {
  const { inputs, store } = fixture();
  inputs.claude = { state: 'working', mtimeMs: 100 };
  assert.equal(store.poll().active, 'claude');
  inputs.claude = { state: 'idle', mtimeMs: null };
  assert.equal(store.poll().active, null);
  inputs.codex = { activity: 'working', newestMtimeMs: 200 };
  assert.equal(store.poll().active, 'codex');
});
