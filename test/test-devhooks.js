#!/usr/bin/env node
// Self-check for scripts/dev-hooks.js. Runs it against throwaway directories
// and asserts the one thing that matters: settings that are not ours survive
// both add and remove.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'dev-hooks.js');
let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(m)
    : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

// The script resolves the settings file from cwd, so each case gets its own.
function withDir(initial, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devhooks-'));
  const file = path.join(dir, '.claude', 'settings.local.json');
  if (initial !== null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof initial === 'string' ? initial
      : JSON.stringify(initial, null, 2) + '\n');
  }
  const run = (cmd) => spawnSync('node', [SCRIPT, cmd], { cwd: dir, encoding: 'utf8' });
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
  try {
    fn({ run, read, file, raw: () => fs.readFileSync(file, 'utf8') });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const events = (s) => Object.keys(s?.hooks || {}).sort();
const ourCount = (s, event) => (s?.hooks?.[event] || []).length;

console.log('1. a developer settings file survives add and remove');
{
  const mine = {
    permissions: { allow: ['Bash(npm run test:*)'], deny: [] },
    env: { FOO: 'bar' },
  };
  withDir(mine, ({ run, read }) => {
    run('add');
    const added = read();
    eq('permissions survive add', added.permissions, mine.permissions);
    eq('env survives add', added.env, mine.env);
    eq('both events registered', events(added), ['PreToolUse', 'SessionStart']);

    run('remove');
    const left = read();
    eq('file still exists after remove', left !== null, true);
    eq('permissions survive remove', left.permissions, mine.permissions);
    eq('env survives remove', left.env, mine.env);
    eq('no hooks key left behind', 'hooks' in left, false);
  });
}

console.log('2. a foreign hook registration is left alone');
{
  const theirs = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
    },
  };
  withDir(theirs, ({ run, read }) => {
    run('add');
    const added = read();
    eq('our entry joins the foreign matcher', ourCount(added, 'PreToolUse'), 2);
    eq('the foreign PreToolUse entry is first', added.hooks.PreToolUse[0].matcher, 'Bash');
    eq('an unrelated event is untouched', added.hooks.Stop, theirs.hooks.Stop);

    run('remove');
    const left = read();
    eq('only ours is pruned', left.hooks.PreToolUse, theirs.hooks.PreToolUse);
    eq('the unrelated event still stands', left.hooks.Stop, theirs.hooks.Stop);
  });
}

console.log('3. a file we created is a file we clean up');
{
  withDir(null, ({ run, read, file }) => {
    run('add');
    eq('add creates the file', read() !== null, true);
    run('remove');
    eq('remove takes it away again', fs.existsSync(file), false);
  });
}

console.log('4. add is idempotent');
{
  withDir(null, ({ run, read }) => {
    run('add');
    run('add');
    const twice = read();
    eq('one PreToolUse registration, not two', ourCount(twice, 'PreToolUse'), 1);
    eq('one SessionStart registration, not two', ourCount(twice, 'SessionStart'), 1);
  });
}

console.log('5. an unparseable file is refused, not overwritten');
{
  const broken = '{ "permissions": { "allow": [] }, } // trailing comma\n';
  withDir(broken, ({ run, raw }) => {
    const r = run('add');
    eq('add fails loudly', r.status, 1);
    eq('the message names the cause', /not valid JSON/.test(r.stderr), true);
    eq('the file is byte-for-byte intact', raw(), broken);
  });
}

console.log('6. a JSON file that is not an object is refused too');
{
  withDir('["nope"]\n', ({ run, raw }) => {
    const r = run('add');
    eq('add fails', r.status, 1);
    eq('the file is intact', raw(), '["nope"]\n');
  });
}

console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
process.exit(fail);
