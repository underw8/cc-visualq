#!/usr/bin/env node
// Self-check for hooks/lib/launch.js. Stubs launchers on PATH so nothing real
// is invoked, and asserts selection is by attempt rather than by presence.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', 'hooks', 'lib', 'launch.js');
let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  got === want ? ok(m) : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

// Each stub is a shell script whose exit status and output we control per case.
// `which` is stubbed too, so PATH presence is decided by the case, not the host.
function makeBin(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '#!/bin/sh\n' + body + '\n');
  fs.chmodSync(p, 0o755);
}

// Run openUrl in a child so PATH and env are isolated per case.
function launch(dir, url, env = {}) {
  const code = `const {openUrl}=require(${JSON.stringify(LIB)});
    process.stdout.write(String(openUrl(${JSON.stringify(url)})));`;
  return execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: { PATH: dir, HOME: os.homedir(), ...env },
  }).trim();
}

// A stub that records how it was called, so argument and env handling is
// asserted rather than assumed. PATH is replaced wholesale per case, so `env`
// is reached by absolute path while `printf` is a shell builtin.
const RECORD = 'printf "%s\\n" "$@" > "$REC/args"; /usr/bin/env > "$REC/env"; exit 0';

function withDir(bins, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-'));
  for (const [n, body] of Object.entries(bins)) makeBin(dir, n, body);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const CAP = { CMUX_SOCKET_CAPABILITY: 'v1.token' };

console.log('1. selection');
{
  withDir({ cmux: 'exit 0', open: 'exit 0', which: 'exit 0' }, (d) => {
    eq('cmux wins when it succeeds', launch(d, 'file:///tmp/p.html', CAP), 'cmux');
  });

  withDir({ cmux: 'exit 1', open: 'exit 0', which: 'exit 0' }, (d) => {
    eq('a failing cmux falls through to open', launch(d, 'file:///tmp/p.html', CAP), 'open');
  });

  withDir({ cmux: 'exit 0', open: 'exit 0', which: 'exit 0' }, (d) => {
    eq('no capability token skips cmux entirely', launch(d, 'file:///tmp/p.html'), 'open');
  });

  withDir({ open: 'exit 0', which: 'echo /usr/bin/open; exit 0' }, (d) => {
    eq('cmux missing -> open', launch(d, 'file:///tmp/p.html', CAP), 'open');
  });

  withDir({ which: 'exit 1' }, (d) => {
    eq('nothing available -> null', launch(d, 'file:///tmp/p.html'), 'null');
  });

  withDir({ cmux: 'exit 0', which: 'exit 0' }, (d) => {
    eq('CC_VISUALQ_OPEN overrides selection',
      launch(d, 'file:///tmp/p.html', { ...CAP, CC_VISUALQ_OPEN: 'firefox --private-window' }),
      'override');
  });
}

console.log('2. what cmux is handed');
{
  withDir({ cmux: RECORD, which: 'exit 0' }, (d) => {
    const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    launch(d, 'file:///tmp/a%20b.html', { ...CAP, REC: rec });
    const args = fs.readFileSync(path.join(rec, 'args'), 'utf8').trim().split('\n');
    eq('subcommand is open', args[0], 'open');
    eq('file:// stripped to a path, percent-decoded', args[1], '/tmp/a b.html');
    eq('focus is forced', args.slice(2).join(' '), '--focus true');
    fs.rmSync(rec, { recursive: true, force: true });
  });

  withDir({ cmux: RECORD, which: 'exit 0' }, (d) => {
    const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    launch(d, 'http://127.0.0.1:5555/', { ...CAP, REC: rec });
    const args = fs.readFileSync(path.join(rec, 'args'), 'utf8').trim().split('\n');
    eq('an http url passes through untouched', args[1], 'http://127.0.0.1:5555/');
    fs.rmSync(rec, { recursive: true, force: true });
  });

  withDir({ cmux: RECORD, which: 'exit 0' }, (d) => {
    const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    launch(d, 'file:///tmp/p.html', {
      ...CAP, REC: rec,
      CMUX_SURFACE_ID: 'stale-surface',
      CMUX_PANEL_ID: 'stale-panel',
      CMUX_WORKSPACE_ID: 'workspace:1',
    });
    const env = fs.readFileSync(path.join(rec, 'env'), 'utf8');
    eq('a stale surface id is not inherited', /^CMUX_SURFACE_ID=/m.test(env), false);
    eq('a stale panel id is not inherited', /^CMUX_PANEL_ID=/m.test(env), false);
    eq('the workspace id survives', /^CMUX_WORKSPACE_ID=workspace:1$/m.test(env), true);
    fs.rmSync(rec, { recursive: true, force: true });
  });
}

console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
process.exit(fail);
