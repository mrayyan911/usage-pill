'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCodexSnapshot } = require('../src/main/providers/codex');

test('large root rollout retains identity and turn state behind the tail; completed guardian cannot mask it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pill-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root.jsonl');
  const guardian = path.join(dir, 'guardian.jsonl');
  const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  fs.writeFileSync(root, fixture('codex-rollout-root.jsonl') + '\n' + JSON.stringify({ type: 'response_item', payload: 'x'.repeat(100_000) }) + '\n');
  fs.writeFileSync(guardian, fixture('codex-rollout-subagent.jsonl'));
  fs.utimesSync(root, 100, 100);
  fs.utimesSync(guardian, 200, 200);
  const files = [guardian, root];
  let snapshot = readCodexSnapshot({ files });
  assert.equal(snapshot.usage.percent, 10);
  assert.equal(snapshot.activity, 'working');
  fs.appendFileSync(root, JSON.stringify({type:'event_msg',payload:{type:'task_complete',turn_id:'bbbbbbbb-0000-7000-8000-000000000002'}}) + '\n');
  snapshot = readCodexSnapshot({ files });
  assert.equal(snapshot.activity, 'idle');
  assert.equal(snapshot.usage.percent, 10);
  const update = JSON.stringify({type:'event_msg',payload:{type:'token_count',rate_limits:{primary:{used_percent:12}}}});
  fs.appendFileSync(root, update.slice(0, 40));
  assert.equal(readCodexSnapshot({ files }).usage.percent, 10, 'partial writes must not erase usage');
  fs.appendFileSync(root, update.slice(40) + '\n');
  assert.equal(readCodexSnapshot({ files }).usage.percent, 12);
  fs.writeFileSync(root, fixture('codex-rollout-subagent.jsonl'));
  assert.equal(readCodexSnapshot({ files }).usage.percent, null, 'replacement must not retain root identity');
});

test('older abandoned subagent does not override a newer completed root', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pill-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root.jsonl');
  const sub = path.join(dir, 'sub.jsonl');
  fs.writeFileSync(root, fs.readFileSync(path.join(__dirname, 'fixtures/codex-rollout-root.jsonl'), 'utf8').trim().split('\n').slice(0, -1).join('\n') + '\n');
  fs.writeFileSync(sub, fs.readFileSync(path.join(__dirname, 'fixtures/codex-rollout-subagent.jsonl'), 'utf8').trim().split('\n').slice(0, -1).join('\n') + '\n');
  fs.utimesSync(root, 200, 200);
  fs.utimesSync(sub, 100, 100);
  assert.equal(readCodexSnapshot({ files: [root, sub] }).activity, 'idle');
  fs.utimesSync(sub, 300, 300);
  assert.equal(readCodexSnapshot({ files: [root, sub] }).activity, 'working');
});
