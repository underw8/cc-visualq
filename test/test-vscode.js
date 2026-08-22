#!/usr/bin/env node
// Self-check for hooks/lib/vscode.js: the settings entry is put back, the stub
// is cleaned up, and a settings file that cannot be round-tripped is left alone.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openInVSCode, restoreOrphan } = require('../hooks/lib/vscode.js');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  got === want ? ok(m) : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

// `code` is stubbed on PATH so nothing real is launched. The stub records the
// settings file as it stood mid-launch, which is the only moment the
// association is supposed to exist.
function workspace(codeBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsws-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vsbin-'));
  fs.writeFileSync(path.join(bin, 'code'), '#!/bin/sh\n' + codeBody + '\n');
  fs.chmodSync(path.join(bin, 'code'), 0o755);
  return { dir, bin, cleanup: () => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); } };
}

const SEEN = 'cat "$2" 2>/dev/null > "$SEEN_STUB"; cat "$WS/.vscode/settings.json" > "$SEEN_SETTINGS"; exit 0';
const run = (w, url, env = {}) => {
  const set = { PATH: w.bin + ':' + process.env.PATH, WS: w.dir, ...env };
  const saved = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  try {
    return openInVSCode(url, w.dir, { settleMs: 10 });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

console.log('1. no settings file to begin with');
{
  const w = workspace(SEEN);
  const seenSettings = path.join(w.dir, 'seen-settings');
  const seenStub = path.join(w.dir, 'seen-stub');
  const okd = run(w, 'http://127.0.0.1:5555/p', { SEEN_SETTINGS: seenSettings, SEEN_STUB: seenStub });

  eq('reports success', okd, true);
  const mid = JSON.parse(fs.readFileSync(seenSettings, 'utf8'));
  eq('association exists while the editor opens',
    mid['workbench.editorAssociations']['**/askq-*.html'], 'workbench.editor.browser');
  const stub = fs.readFileSync(seenStub, 'utf8');
  eq('stub redirects to the loopback url', stub.includes('http://127.0.0.1:5555/p'), true);
  // Navigation opens a new tab and leaves this one on a stub about to be
  // deleted, so the stub has to dismiss itself.
  eq('stub closes its own tab after handing off', stub.includes('window.close()'), true);
  eq('settings file removed afterwards', fs.existsSync(path.join(w.dir, '.vscode', 'settings.json')), false);
  eq('marker removed afterwards', fs.existsSync(path.join(w.dir, '.vscode', '.askq-restore.json')), false);
  eq('no stub left behind', fs.readdirSync(w.dir).filter((f) => f.startsWith('askq-')).length, 0);
  w.cleanup();
}

console.log('2. an existing settings file is merged and restored byte for byte');
{
  const w = workspace(SEEN);
  const settings = path.join(w.dir, '.vscode', 'settings.json');
  const before = JSON.stringify({
    'editor.tabSize': 2,
    'workbench.editorAssociations': { '*.ipynb': 'jupyter-notebook' },
  }, null, 4) + '\n';
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, before);

  const seenSettings = path.join(w.dir, 'seen-settings');
  run(w, 'http://127.0.0.1:5555/p', { SEEN_SETTINGS: seenSettings, SEEN_STUB: path.join(w.dir, 'seen-stub') });

  const mid = JSON.parse(fs.readFileSync(seenSettings, 'utf8'));
  eq('unrelated keys survive the merge', mid['editor.tabSize'], 2);
  eq('existing associations survive', mid['workbench.editorAssociations']['*.ipynb'], 'jupyter-notebook');
  eq('ours is added', mid['workbench.editorAssociations']['**/askq-*.html'], 'workbench.editor.browser');
  eq('restored byte for byte, formatting included', fs.readFileSync(settings, 'utf8'), before);
  eq('a .vscode that was already there is left alone', fs.existsSync(path.dirname(settings)), true);
  w.cleanup();
}

console.log('3. settings that cannot round-trip are not touched');
{
  const w = workspace(SEEN);
  const settings = path.join(w.dir, '.vscode', 'settings.json');
  const before = '{\n  // a comment VS Code allows and JSON.parse does not\n  "editor.tabSize": 2,\n}\n';
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, before);

  const okd = run(w, 'http://127.0.0.1:5555/p', { SEEN_SETTINGS: path.join(w.dir, 's'), SEEN_STUB: path.join(w.dir, 'b') });
  eq('reports failure so the caller falls through', okd, false);
  eq('the file is untouched', fs.readFileSync(settings, 'utf8'), before);
  w.cleanup();
}

console.log('4. a failing `code` still restores');
{
  const w = workspace('exit 3');
  const settings = path.join(w.dir, '.vscode', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '{"editor.tabSize":2}\n');

  const okd = run(w, 'http://127.0.0.1:5555/p');
  eq('reports failure', okd, false);
  eq('settings restored', fs.readFileSync(settings, 'utf8'), '{"editor.tabSize":2}\n');
  eq('no stub left behind', fs.readdirSync(w.dir).filter((f) => f.startsWith('askq-')).length, 0);
  w.cleanup();
}

console.log('5. a crash mid-launch is repaired on the next call');
{
  const w = workspace(SEEN);
  const vs = path.join(w.dir, '.vscode');
  fs.mkdirSync(vs, { recursive: true });
  // Exactly the state a kill -9 between write and restore would leave.
  const orphanStub = path.join(w.dir, 'askq-999.html');
  fs.writeFileSync(path.join(vs, 'settings.json'), '{"workbench.editorAssociations":{"**/askq-*.html":"workbench.editor.browser"}}');
  fs.writeFileSync(orphanStub, 'leftover');
  fs.writeFileSync(path.join(vs, '.askq-restore.json'),
    JSON.stringify({ original: '{"editor.tabSize":2}\n', stub: orphanStub }));

  restoreOrphan(w.dir);
  eq('the original settings come back', fs.readFileSync(path.join(vs, 'settings.json'), 'utf8'), '{"editor.tabSize":2}\n');
  eq('the orphaned stub is swept up', fs.existsSync(orphanStub), false);
  eq('the marker is cleared', fs.existsSync(path.join(vs, '.askq-restore.json')), false);
  w.cleanup();
}

console.log('6. an absent original is recorded as absent, not as an empty file');
{
  const w = workspace(SEEN);
  const vs = path.join(w.dir, '.vscode');
  fs.mkdirSync(vs, { recursive: true });
  fs.writeFileSync(path.join(vs, 'settings.json'), '{"whatever":1}');
  fs.writeFileSync(path.join(vs, '.askq-restore.json'), JSON.stringify({ original: null, stub: null }));

  restoreOrphan(w.dir);
  eq('a settings file that never existed is removed, not emptied',
    fs.existsSync(path.join(vs, 'settings.json')), false);
  w.cleanup();
}

console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
process.exit(fail);
