'use strict';

const UTILITY_COMMANDS = {
  claude: new Set('agents auth auto-mode doctor gateway import install logs mcp plugin plugins project respawn rm setup-token stop kill update upgrade help'.split(' ')),
  codex: new Set('agents login logout mcp mcp-server plugin app-server remote-control app completion update doctor sandbox debug apply a queue archive delete migrate-rollouts unarchive cloud exec-server features help'.split(' ')),
};
const VALUE_OPTIONS = {
  claude: new Set('--agent --agents --append-system-prompt --autocompact --debug-file --effort --environment --fallback-model --input-format --json-schema --max-budget-usd --model -n --name --output-format -p --print --permission-mode --session-id --setting-sources --settings --system-prompt --system-prompt-file --append-system-prompt-file --system-prompt-snapshot'.split(' ')),
  codex: new Set('-c --config --enable --disable --remote --remote-auth-token-env -i --image -m --model --local-provider -p --profile -s --sandbox -C --cd --add-dir -a --ask-for-approval -o --output-last-message --output-schema'.split(' ')),
};
// Claude Desktop ships its own claude executable (Windows MSIX under
// WindowsApps, or a per-user AnthropicClaude install; a bundled macOS app
// under /Applications) that is indistinguishable from the CLI by name/args
// alone. The Windows markers are confirmed against a real machine where
// Desktop's main and renderer processes were all misclassified as CLI
// sessions; the macOS marker is a best-effort guess pending the same
// real-install verification. No Linux marker yet — add one if/when Claude
// Desktop ships there rather than guessing a path.
const DESKTOP_APP_PATH_MARKERS = ['\\windowsapps\\', '\\anthropicclaude\\', '/applications/claude.app/'];

function stripExeExt(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -4) : lower;
}

// Providers hand back OS-native paths (backslash on Windows, forward slash
// elsewhere); normalize before taking the last segment so this works for argv
// captured on any platform regardless of which platform is running the code.
function basenameOf(p) {
  return (p || '').replaceAll('\\', '/').split('/').filter(Boolean).pop() || '';
}

// row is the normalized shape every provider (Windows/macOS/Linux) produces:
// { name, pid, parentPid, createdAt, argv }. argv is null when the OS
// couldn't report a command line for this read (observed on Windows via
// WMI); returning undefined lets readSessions fall back to a prior read of
// the same process instead of dropping it.
function classifyProcess(row) {
  const bareName = stripExeExt(row.name || '');
  if (!['claude', 'codex', 'node'].includes(bareName)) return null;
  if (row.argv == null) return undefined;
  const argv = row.argv;
  const exePath = (argv[0] || '').toLowerCase();
  if (DESKTOP_APP_PATH_MARKERS.some(marker => exePath.includes(marker))) return null;
  let agent = bareName === 'node' ? null : bareName;
  let args = argv.slice(1);
  if (bareName === 'node') {
    const script = (args[0] || '').replaceAll('\\', '/').toLowerCase();
    if (script.endsWith('/@openai/codex/bin/codex.js')) agent = 'codex';
    else if (script.endsWith('/@anthropic-ai/claude-code/cli.js')) agent = 'claude';
    else return null;
    args = args.slice(1);
  } else if (stripExeExt(basenameOf(argv[0] || '')) !== bareName) {
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
    if (!Number.isInteger(row.pid) || !row.createdAt) throw new Error('Incomplete process snapshot');
    let agent = classifyProcess(row);
    if (agent === undefined) agent = previous.find(s => s.pid === row.pid && s.createdAt === row.createdAt)?.agent;
    if (agent) sessions.push({ agent, pid: row.pid, parentPid: row.parentPid, createdAt: row.createdAt });
  }
  return sessions.filter(s => !sessions.some(child => child.parentPid === s.pid && child.agent === s.agent));
}

module.exports = { classifyProcess, readSessions };
