'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseActivityLog } = require('../src/main/parsers/activityLog');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'activity-log.jsonl'), 'utf8');

test('activity log: ends on an unfinished start -> working', () => {
  const { state, lastSessionId } = parseActivityLog(fixture);
  assert.equal(state, 'working');
  assert.equal(lastSessionId, 's2');
});

test('activity log: a fully closed turn (start -> subagent -> end) -> idle', () => {
  const lines = fixture.trim().split('\n').slice(0, 4).join('\n');
  const { state } = parseActivityLog(lines);
  assert.equal(state, 'idle');
});

test('activity log: subagent still running (no subagent_stop yet) -> working', () => {
  const lines = fixture.trim().split('\n').slice(0, 2).join('\n');
  const { state } = parseActivityLog(lines);
  assert.equal(state, 'working');
});

test('activity log: blocked on permission prompt stays blocked, not working', () => {
  const text = '{"agent":"claude","ev":"start","ts":"t1","session_id":"s1"}\n' +
    '{"agent":"claude","ev":"blocked","ts":"t2","session_id":"s1"}';
  const { state } = parseActivityLog(text);
  assert.equal(state, 'blocked');
});

test('activity log: StopFailure recorded as "end" clears working state', () => {
  const text = '{"agent":"claude","ev":"start","ts":"t1","session_id":"s1"}\n' +
    '{"agent":"claude","ev":"end","ts":"t2","session_id":"s1"}';
  const { state } = parseActivityLog(text);
  assert.equal(state, 'idle');
});

test('activity log: empty log -> idle, no timestamps', () => {
  const { state, lastTs, lastSessionId } = parseActivityLog('');
  assert.equal(state, 'idle');
  assert.equal(lastTs, null);
  assert.equal(lastSessionId, null);
});

test('activity log: records for other agents are ignored', () => {
  const text = '{"agent":"codex","ev":"start","ts":"t1","session_id":"x"}';
  const { state, lastTs } = parseActivityLog(text);
  assert.equal(state, 'idle');
  assert.equal(lastTs, null);
});
