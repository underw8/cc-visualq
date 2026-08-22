'use strict';

// Opens a page in VS Code's integrated browser.
//
// Three facts shape this. The browser editor registers the `file` scheme only,
// so a loopback URL cannot be handed to `code` — a rendered file:// page
// navigates itself there instead. The editor is chosen by
// `workbench.editorAssociations`, which no CLI can read, so the entry is
// written before the open and taken away after. And the browser refuses any
// file outside a trusted root, which in practice means the open workspace
// folder, so both the stub and the settings live under it.
//
// Every write here is transient and reversible. A crash between writing and
// restoring leaves a marker naming what to put back; the next call restores it
// before doing anything else.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GLOB = '**/askq-*.html';
const EDITOR = 'workbench.editor.browser';
const KEY = 'workbench.editorAssociations';

const paths = (dir) => ({
  settings: path.join(dir, '.vscode', 'settings.json'),
  marker: path.join(dir, '.vscode', '.askq-restore.json'),
});

// Block without spinning: the page must be open before the association goes
// away, and the hook has no event to wait on.
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A previous run died before putting the file back.
function restoreOrphan(dir) {
  const p = paths(dir);
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(p.marker, 'utf8'));
  } catch {
    return;
  }
  try {
    if (saved.original === null) fs.rmSync(p.settings, { force: true });
    else fs.writeFileSync(p.settings, saved.original, 'utf8');
    if (saved.stub) fs.rmSync(saved.stub, { force: true });
  } finally {
    fs.rmSync(p.marker, { force: true });
  }
}

// Returns the settings text to write, or null when the file must not be
// touched: comments and trailing commas are legal in VS Code's settings and
// would not survive a parse-and-serialize round trip.
function merged(original) {
  if (original === null) return JSON.stringify({ [KEY]: { [GLOB]: EDITOR } }, null, 2) + '\n';
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const assoc = { ...parsed[KEY], [GLOB]: EDITOR };
  return JSON.stringify({ ...parsed, [KEY]: assoc }, null, 2) + '\n';
}

// `dir` must be the folder VS Code has open, since that is what the browser
// trusts. Returns false whenever anything is not as expected, so the caller
// falls through to the next launcher rather than showing markup as text.
function openInVSCode(url, dir, { settleMs = 2500 } = {}) {
  if (!dir) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }

  restoreOrphan(dir);
  const p = paths(dir);
  const original = fs.existsSync(p.settings) ? fs.readFileSync(p.settings, 'utf8') : null;
  const next = merged(original);
  if (next === null) return false;

  const stub = path.join(dir, `askq-${process.pid}.html`);
  fs.mkdirSync(path.dirname(p.settings), { recursive: true });
  fs.writeFileSync(p.marker, JSON.stringify({ original, stub }), 'utf8');

  try {
    fs.writeFileSync(p.settings, next, 'utf8');
    // The rendered stub navigates itself to the loopback page; `code` cannot
    // be handed that URL directly.
    // The browser editor stays bound to the file it was opened with, so
    // navigating away lands the page in a *new* tab and leaves this one on a
    // stub that is about to be deleted. It closes itself once the handoff has
    // had a moment; the editor honours window.close().
    fs.writeFileSync(stub, `<!doctype html><title>opening…</title>
<script>
location.replace(${JSON.stringify(url)});
setTimeout(function () { window.close(); }, 800);
</script>
`, 'utf8');
    const r = spawnSync('code', ['-r', stub], { timeout: 10000, encoding: 'utf8' });
    if (r.error || r.status !== 0) return false;
    // The association is read when the editor opens, so it has to outlive the
    // command by a moment.
    pause(settleMs);
    return true;
  } finally {
    if (original === null) fs.rmSync(p.settings, { force: true });
    else fs.writeFileSync(p.settings, original, 'utf8');
    fs.rmSync(stub, { force: true });
    fs.rmSync(p.marker, { force: true });
  }
}

module.exports = { openInVSCode, restoreOrphan };
