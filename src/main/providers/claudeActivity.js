'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readTail, newestFileIn } = require('../fsUtil');
const { parseClaudeActivity } = require('../parsers/claudeTranscript');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_CANDIDATES = 6;

/**
 * Transcript-tail fallback locator: Claude Code fans one project directory
 * out per working-directory slug under ~/.claude/projects, each containing
 * one .jsonl per session. Bound the candidate set to the newest file per
 * project dir, capped at MAX_CANDIDATES overall, re-resolved by the caller
 * on its own 5s cadence (this function itself is cheap -- one readdir per
 * project dir plus one statSync per newest file).
 *
 * @returns {{filePath:string, mtimeMs:number}[]} newest-first
 */
function listCandidateTranscripts() {
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PROJECTS_ROOT, entry.name);
    const newest = newestFileIn(dir, { suffix: '.jsonl' });
    if (newest) candidates.push(newest);
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.slice(0, MAX_CANDIDATES);
}

/**
 * @returns {{state:'working'|'idle'|'unknown', mtimeMs:number|null, filePath:string|null}}
 */
function readClaudeActivityFromTranscripts() {
  const candidates = listCandidateTranscripts();
  if (candidates.length === 0) return { state: 'unknown', mtimeMs: null, filePath: null };

  const newest = candidates[0];
  let text;
  try {
    text = readTail(newest.filePath);
  } catch {
    return { state: 'unknown', mtimeMs: null, filePath: null };
  }
  const state = parseClaudeActivity(text);
  return { state, mtimeMs: newest.mtimeMs, filePath: newest.filePath };
}

function hasEverUsedClaude() {
  return listCandidateTranscripts().length > 0;
}

module.exports = { listCandidateTranscripts, readClaudeActivityFromTranscripts, hasEverUsedClaude };
