'use strict';

const path = require('node:path');

const UTILITY_COMMANDS = {
  claude: new Set('agents auth auto-mode doctor gateway import install logs mcp plugin plugins project respawn rm setup-token stop kill update upgrade help'.split(' ')),
  codex: new Set('agents login logout mcp mcp-server plugin app-server remote-control app completion update doctor sandbox debug apply a queue archive delete migrate-rollouts unarchive cloud exec-server features help'.split(' ')),
};
const VALUE_OPTIONS = {
  claude: new Set('--agent --agents --append-system-prompt --autocompact --debug-file --effort --environment --fallback-model --input-format --json-schema --max-budget-usd --model -n --name --output-format -p --print --permission-mode --session-id --setting-sources --settings --system-prompt --system-prompt-file --append-system-prompt-file --system-prompt-snapshot'.split(' ')),
  codex: new Set('-c --config --enable --disable --remote --remote-auth-token-env -i --image -m --model --local-provider -p --profile -s --sandbox -C --cd --add-dir -a --ask-for-approval -o --output-last-message --output-schema'.split(' ')),
};
// Claude Desktop ships its own claude.exe (MSIX under WindowsApps, or a
// per-user AnthropicClaude install) that is indistinguishable from the CLI by
// name/args alone — confirmed against a real machine where Desktop's main and
// renderer processes were all misclassified as CLI sessions.
const DESKTOP_APP_PATH_MARKERS = ['\\windowsapps\\', '\\anthropicclaude\\'];

// Windows preserves backslashes except immediately before a quote. Splitting
// on spaces would mistake words inside prompts for utility commands.
function splitCommandLine(line) {
  const args = [];
  let token = '', quoted = false, started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      let count = 1;
      while (line[i + 1] === '\\') { count++; i++; }
      if (line[i + 1] === '"') {
        token += '\\'.repeat(Math.floor(count / 2));
        i++;
        if (count % 2) token += '"';
        else quoted = !quoted;
      } else token += '\\'.repeat(count);
      started = true;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(char) && !quoted) {
      if (started) args.push(token);
      token = ''; started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (started) args.push(token);
  return args;
}

function classifyProcess(row) {
  const name = row.Name?.toLowerCase();
  if (!['claude.exe', 'codex.exe', 'node.exe'].includes(name)) return null;
  if (!row.CommandLine) return undefined;
  const argv = splitCommandLine(row.CommandLine);
  const exePath = (argv[0] || '').toLowerCase();
  if (DESKTOP_APP_PATH_MARKERS.some(marker => exePath.includes(marker))) return null;
  let agent = name === 'node.exe' ? null : name.slice(0, -4);
  let args = argv.slice(1);
  if (name === 'node.exe') {
    const script = (args[0] || '').replaceAll('\\', '/').toLowerCase();
    if (script.endsWith('/@openai/codex/bin/codex.js')) agent = 'codex';
    else if (script.endsWith('/@anthropic-ai/claude-code/cli.js')) agent = 'claude';
    else return null;
    args = args.slice(1);
  } else if (path.win32.basename(argv[0] || '').toLowerCase() !== name) {
    return null;
  }

  let firstWord = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (['--help', '-h', '--version', agent === 'claude' ? '-v' : '-V'].includes(arg)) return null;
    if (agent === 'claude' && ['--chrome-native-host', '--claude-in-chrome-mcp', '--sdk-url'].includes(arg)) return null;
    if (VALUE_OPTIONS[agent].has(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    if (firstWord && UTILITY_COMMANDS[agent].has(arg)) return null;
    firstWord = false;
  }
  return agent;
}

function readSessions(rows, previous = []) {
  if (!Array.isArray(rows)) throw new Error('Invalid process snapshot');
  const sessions = [];
  for (const row of rows) {
    if (!Number.isInteger(row.ProcessId) || !row.CreationDate) throw new Error('Incomplete process snapshot');
    let agent = classifyProcess(row);
    if (agent === undefined) agent = previous.find(s => s.pid === row.ProcessId && s.createdAt === row.CreationDate)?.agent;
    if (agent) sessions.push({ agent, pid: row.ProcessId, parentPid: row.ParentProcessId, createdAt: row.CreationDate });
  }
  return sessions.filter(s => !sessions.some(child => child.parentPid === s.pid && child.agent === s.agent));
}

module.exports = { classifyProcess, readSessions };
