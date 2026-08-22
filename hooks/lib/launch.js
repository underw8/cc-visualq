'use strict';

// Opens a URL in the terminal's embedded browser when there is one, falling
// back to the OS handler.
//
// Selection is by attempt, not by env sniffing: TERM_PROGRAM is unreliable (a
// cmux window running a Ghostty profile reports iTerm.app, and a session under
// the VS Code extension host reports ghostty while sitting inside both). Each
// launcher reports whether it actually displayed the page, and the first that
// succeeds wins.

const { spawn, spawnSync } = require('node:child_process');

const onPath = (cmd) => {
  try {
    return spawnSync('which', [cmd], { timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
};

// The OS handler cannot report whether a browser appeared, and the hook may
// exit immediately after, so the child is detached and success is assumed.
const detached = (cmd, pre = []) => (url) => {
  try {
    const child = spawn(cmd, [...pre, url], { detached: true, stdio: 'ignore' });
    // A missing binary surfaces as an async 'error' event, not a throw, and an
    // unhandled one takes the hook down with it.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
};

// Ordered most specific to least.
const LAUNCHERS = [
  {
    name: 'cmux',
    // The capability token exists only inside cmux. Without it `cmux open`
    // tries to start cmux.app and blocks for about ten seconds.
    available: () => Boolean(process.env.CMUX_SOCKET_CAPABILITY) && onPath('cmux'),
    open: (url) => {
      // cmux takes a bare path or an http URL. A file:// URL is read as a
      // relative path and normalized into nonsense, so the scheme comes off.
      const arg = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url;
      const env = { ...process.env };
      // A surface id inherited from a terminal that has since been replaced
      // resolves to nothing and fails the call. Workspace ids survive a
      // respawn, so CMUX_WORKSPACE_ID stays and still places the tab.
      delete env.CMUX_SURFACE_ID;
      delete env.CMUX_PANEL_ID;
      // HTML opens in an unfocused split by default; the page is the point.
      // Synchronous because the exit code is the only honest signal, and the
      // call returns in about 100ms.
      const r = spawnSync('cmux', ['open', arg, '--focus', 'true'],
        { timeout: 5000, encoding: 'utf8', env });
      return !r.error && r.status === 0;
    },
  },
  {
    name: 'vscode',
    // After cmux, which opens a split without touching the workspace: a cmux
    // that fails falls through to here, so trying it first costs nothing. The
    // browser refuses any file outside a trusted root, so this reports failure
    // and hands on when the project dir is not the folder VS Code has open.
    available: () => Boolean(process.env.VSCODE_PID) && onPath('code'),
    open: (url) => require('./vscode.js')
      .openInVSCode(url, process.env.CLAUDE_PROJECT_DIR || process.cwd()),
  },
  { name: 'open', available: () => onPath('open'), open: detached('open') },
  { name: 'xdg-open', available: () => onPath('xdg-open'), open: detached('xdg-open') },
];

// CC_VISUALQ_OPEN overrides selection entirely: `CC_VISUALQ_OPEN="firefox"`.
function override() {
  const raw = process.env.CC_VISUALQ_OPEN;
  if (!raw?.trim()) return null;
  const [cmd, ...args] = raw.trim().split(/\s+/);
  return { name: 'override', available: () => true, open: detached(cmd, args) };
}

// The launchers worth attempting here, in order.
function resolve() {
  const forced = override();
  return forced ? [forced] : LAUNCHERS.filter((l) => l.available());
}

function openUrl(url) {
  for (const launcher of resolve()) {
    if (launcher.open(url)) return launcher.name;
  }
  return null;
}

module.exports = { openUrl };
