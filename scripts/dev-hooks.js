#!/usr/bin/env node
// Registers and unregisters the dev-install hooks in
// .claude/settings.local.json.
//
// That file belongs to the developer, not to this plugin: their own
// permissions, env and MCP settings live in it. So it is merged and pruned,
// never written or deleted whole. Only entries pointing at this repo's hooks
// are touched, matched by the path in their command.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(process.cwd(), '.claude', 'settings.local.json');
const OURS = /hooks\/askq(\.js|-rule\.md)/;

const ENTRIES = {
  PreToolUse: {
    matcher: 'AskUserQuestion',
    hooks: [{
      type: 'command',
      timeout: 960,
      command: 'node "${CLAUDE_PROJECT_DIR}/hooks/askq.js"',
    }],
  },
  SessionStart: {
    hooks: [{
      type: 'command',
      timeout: 5,
      command: 'cat "${CLAUDE_PROJECT_DIR}/hooks/askq-rule.md"',
    }],
  },
};

const isOurs = (group) =>
  (group?.hooks || []).some((h) => OURS.test(h?.command || ''));

// A file we cannot parse is a file we must not overwrite.
function read() {
  let parsed;
  try {
    // A JSON SyntaxError carries no `code`, so one catch covers both.
    parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${FILE} is not valid JSON. Fix or move it, then retry.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${FILE} is not a JSON object. Fix or move it, then retry.`);
  }
  return parsed;
}

// Drops our registrations and any container left empty by the drop, so an
// install that created the file leaves nothing behind when it is removed.
function strip(settings) {
  const { hooks } = settings;
  if (!hooks || typeof hooks !== 'object') return settings;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

// Returns true when nothing was left to keep and the file is gone.
function write(settings) {
  if (Object.keys(settings).length === 0) {
    fs.rmSync(FILE, { force: true });
    return true;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(settings, null, 2)}\n`);
  return false;
}

function main(cmd) {
  if (cmd !== 'add' && cmd !== 'remove') {
    console.error('usage: dev-hooks.js add|remove');
    return 2;
  }
  const existed = fs.existsSync(FILE);
  // `add` strips first, so re-running replaces our entries instead of
  // stacking a second registration that would open two pages per question.
  const settings = strip(read());
  if (cmd === 'add') {
    settings.hooks ??= {};
    for (const [event, entry] of Object.entries(ENTRIES)) {
      settings.hooks[event] ??= [];
      settings.hooks[event].push(entry);
    }
  }
  // `make install` runs this on the way past, so say plainly that a deleted
  // file held nothing but our entries.
  const gone = write(settings);
  if (cmd === 'add') console.log(`dev hooks: registered in ${FILE}`);
  else if (!existed) console.log('dev hooks: not registered, nothing to do');
  else if (gone) console.log('dev hooks: unregistered (nothing else in the file, so it is gone)');
  else console.log('dev hooks: unregistered (your other settings kept)');
  return 0;
}

try {
  process.exit(main(process.argv[2]));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
