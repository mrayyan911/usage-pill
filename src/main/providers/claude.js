'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/**
 * Reads the OAuth access token fresh from disk on every call. Claude Code
 * owns and rotates this token; we must never attempt our own refresh --
 * doing so risks racing Claude Code's own refresh and invalidating the
 * user's real session.
 */
function readAccessToken() {
  let raw;
  try {
    raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    return (data.claudeAiOauth && data.claudeAiOauth.accessToken) || null;
  } catch {
    return null;
  }
}

function requestUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      USAGE_URL,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/**
 * @returns {Promise<{percent:number|null, resetsAt:Date|null, weeklyPercent:number|null,
 *   planType:string|null, status:'ok'|'unauthenticated'|'error'}>}
 */
async function fetchClaudeUsage() {
  const token = readAccessToken();
  if (!token) {
    return { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'unauthenticated' };
  }

  let response;
  try {
    response = await requestUsage(token);
  } catch {
    return { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' };
  }

  if (response.statusCode === 401) {
    return { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'unauthenticated' };
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' };
  }

  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    return { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' };
  }

  const fiveHour = data.five_hour || {};
  const sevenDay = data.seven_day || {};

  return {
    percent: typeof fiveHour.utilization === 'number' ? fiveHour.utilization : null,
    resetsAt: fiveHour.resets_at ? new Date(fiveHour.resets_at) : null,
    weeklyPercent: typeof sevenDay.utilization === 'number' ? sevenDay.utilization : null,
    planType: null, // Claude's /usage payload doesn't carry plan tier; profile endpoint would.
    status: 'ok',
  };
}

module.exports = { fetchClaudeUsage, readAccessToken, CREDENTIALS_PATH };
