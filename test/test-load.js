#!/usr/bin/env node
// Every lib module must parse and load. First suite deliberately: render.js and
// page-script.js emit CSS and browser JS from template literals, so a backtick
// anywhere inside one — a comment included — closes the string and breaks the
// file. Left to the other suites that surfaces in test-askq as a missing
// decision, three suites from its cause, because the hook crashed before it
// could write one. This one names the file and the line.
//
// It requires nothing at the top: a suite that imports the thing it is checking
// dies before it can report on it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };

const dir = path.join(__dirname, '..', 'hooks', 'lib');

console.log('1. every lib module loads');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
  try {
    require(path.join(dir, f));
    ok(f);
  } catch (e) {
    bad(f, e.message.split('\n')[0]);
  }
}

console.log('2. the hook entry loads');
try {
  // Reading it is enough: requiring askq.js would start a server.
  new (require('node:vm').Script)(
    fs.readFileSync(path.join(__dirname, '..', 'hooks', 'askq.js'), 'utf8'));
  ok('askq.js parses');
} catch (e) {
  bad('askq.js parses', e.message.split('\n')[0]);
}

console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail);
