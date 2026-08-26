#!/usr/bin/env node
// The HTML-preview path: the fragment lib/preview.js builds, and the decision
// askq.js emits when the host says it renders one.
//
// The validator this suite mirrors is the tool's own, read out of the CLI: an
// HTML fragment, holding at least one tag, with no <script> and no <style>. A
// fragment that fails it is rejected by the tool, so the checks are copied
// verbatim rather than described.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withPreviews } = require('../hooks/lib/preview.js');
const { stripTags } = require('../hooks/lib/metrics.js');

const HOOK = path.join(__dirname, '..', 'hooks', 'askq.js');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'askqprev-'));
let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(m)
    : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const has = (m, hay, needle) =>
  String(hay).includes(needle) ? ok(m) : bad(m, `missing ${needle}`);
const lacks = (m, hay, needle) =>
  !String(hay).includes(needle) ? ok(m) : bad(m, `unexpected ${needle}`);

// The tool's validator, transcribed. Returns the message it would return.
function invalid(e) {
  if (e === undefined) return null;
  if (/<\s*(html|body|!doctype)\b/i.test(e)) return 'full document';
  if (/<\s*(script|style)\b/i.test(e)) return 'script or style tag';
  if (!/<[a-z][^>]*>/i.test(e)) return 'no html at all';
  return null;
}

const previewsOf = (questions) => {
  const { questions: cleaned } = stripTags(questions);
  return withPreviews(cleaned, questions);
};

const Q = (options, extra = {}) => [{
  question: 'Which store?', header: 'Store', options, ...extra,
}];

console.log('1. every option carries a fragment the tool accepts');
{
  const out = previewsOf(Q([
    { label: 'Postgres', description: 'Relational. {cost↓: $12/mo, risk↓: low}' },
    { label: 'SQLite', description: 'Embedded. {cost: $0/mo, risk: medium}' },
  ]));
  const previews = out[0].options.map((o) => o.preview);
  eq('one preview per option', previews.filter(Boolean).length, 2);
  eq('each passes the validator', previews.map(invalid), [null, null]);
  has('the tag is stripped from what the dialog shows', out[0].options[0].description,
    'Relational.');
  lacks('and the tag itself is gone', out[0].options[0].description, '{cost');
}

console.log('2. the comparison states every option, not just the one hovered');
{
  const out = previewsOf(Q([
    { label: 'Postgres', description: 'a {cost↓: $12/mo}' },
    { label: 'SQLite', description: 'b {cost: $0/mo}' },
  ]));
  const first = out[0].options[0].preview;
  has('the other option keeps its row', first, 'SQLite');
  has('the key heads a column', first, 'cost');
  has('a direction shows as its glyph', first, '↓');
  has('the reader\'s own row is marked', first, 'font-weight:700">Postgres');
  has('and the other row is not', first, 'font-weight:400">SQLite');
}

console.log('3. the marks: a win ticks, a loss recedes, a gap prints an em dash');
{
  const out = previewsOf(Q([
    { label: 'A', description: 'a {size↓: 3kb, only: 5}' },
    { label: 'B', description: 'b {size: 13kb}' },
  ]));
  const p = out[0].options[0].preview;
  has('the winner takes the tick', p, '✓');
  has('the loser recedes by ink', p, 'opacity:.45');
  has('a key the option lacks is an em dash', p, '—');
  const undirected = previewsOf(Q([
    { label: 'A', description: 'a {size: 3kb}' },
    { label: 'B', description: 'b {size: 13kb}' },
  ]))[0].options[0].preview;
  lacks('an undeclared key ticks nothing', undirected, '✓');
  lacks('and dims nothing', undirected, 'opacity:.45');
}

console.log('4. an ordinal keeps its band, and a direction inverts it');
{
  const severity = previewsOf(Q([
    { label: 'A', description: 'a {risk↓: low}' },
    { label: 'B', description: 'b {risk: critical}' },
  ]))[0].options[0].preview;
  has('low reads as good news', severity, 'light-dark(#046b34,#3fbf72)');
  has('critical reads as bad', severity, 'light-dark(#b3261e,#f2837a)');

  const inverted = previewsOf(Q([
    { label: 'A', description: 'a {reach↑: high}' },
    { label: 'B', description: 'b {reach: none}' },
  ]))[0].options[0].preview;
  has('high is good where more is better', inverted, 'light-dark(#046b34,#3fbf72)');
  has('and none is bad', inverted, 'light-dark(#b3261e,#f2837a)');
}

console.log('5. briefings travel, with their valence intact');
{
  const out = previewsOf([{
    question: 'Which store?<!--brief-->Both hold the same rows.',
    options: [
      { label: 'A', description: 'a<!--brief-->+ mature\n- heavier' },
      { label: 'B', description: 'b' },
    ],
  }]);
  const p = out[0].options[0].preview;
  has('the question briefing opens the fragment', p, 'Both hold the same rows.');
  has('the option briefing closes it', p, 'mature');
  has('the pro glyph survives with no stylesheet', p, '<span class="g">+</span>');
  has('and the con glyph too', p, '<span class="g">−</span>');
  lacks('a question with no metrics draws no table', p, '<table');
  has('an option with no briefing still gets the question one',
    out[0].options[1].preview, 'Both hold the same rows.');
}

console.log('6. nothing to draw means no preview key');
{
  const out = previewsOf(Q([
    { label: 'A', description: 'plain' },
    { label: 'B', description: 'also plain' },
  ]));
  eq('no fragment invented', out[0].options.map((o) => o.preview), [undefined, undefined]);
}

console.log('7. a multiSelect question is left alone');
{
  const out = previewsOf(Q([
    { label: 'A', description: 'a {x↓: 1}' },
    { label: 'B', description: 'b {x: 2}' },
  ], { multiSelect: true }));
  eq('the tool draws previews on single-select only',
    out[0].options.map((o) => o.preview), [undefined, undefined]);
}

console.log('8. model text reaches the fragment escaped');
{
  const out = previewsOf(Q([
    { label: '<img src=x onerror=alert(1)>', description: 'a {x↓: 1}' },
    { label: 'B', description: 'b<!--brief--><script>alert(2)</script> {x: 2}' },
  ]));
  const both = out[0].options.map((o) => o.preview).join('');
  lacks('no tag survives from a label', both, '<img');
  has('it is text instead', both, '&lt;img');
  eq('and the validator still passes', out[0].options.map((o) => invalid(o.preview)),
    [null, null]);
}

console.log('9. the hook emits the decision, and opens nothing');
(async () => {
  const log = path.join(WORK, 'opened.log');
  const stub = path.join(WORK, 'open');
  fs.writeFileSync(stub, `#!/bin/sh\necho "$1" >> ${log}\n`);
  fs.chmodSync(stub, 0o755);

  const run = (input, env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, PATH: WORK + ':' + process.env.PATH, TMPDIR: WORK,
             CC_VISUALQ_OPEN: stub, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const kill = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.on('close', () => {
      clearTimeout(kill);
      resolve({ out, json: (() => { try { return JSON.parse(out); } catch { return null; } })() });
    });
    child.stdin.end(JSON.stringify(input));
  });

  const input = { tool_input: { questions: Q([
    { label: 'Postgres', description: 'a {cost↓: $12/mo}' },
    { label: 'SQLite', description: 'b {cost: $0/mo}' },
  ]) } };

  let r = await run(input, { CLAUDE_CODE_QUESTION_PREVIEW_FORMAT: 'html' });
  const hso = r.json?.hookSpecificOutput;
  eq('the reader stays in the dialog', hso?.permissionDecision, 'ask');
  eq('questions are echoed back whole', hso?.updatedInput?.questions?.length, 1);
  eq('with a fragment on each option',
    hso?.updatedInput?.questions[0].options.filter((o) => o.preview).length, 2);
  eq('no answers map: nobody has chosen yet', hso?.updatedInput?.answers, undefined);
  eq('and no browser was launched', fs.existsSync(log), false);

  console.log('10. any other host still gets the page');
  r = await run(input, { CLAUDE_CODE_QUESTION_PREVIEW_FORMAT: 'markdown' });
  eq('markdown is not the fragment path',
    r.json?.hookSpecificOutput?.permissionDecision, undefined);
  fs.existsSync(log) ? ok('the launcher ran instead')
    : bad('the launcher ran instead', 'nothing opened');

  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(fail ? 'FAIL' : 'PASS');
  process.exit(fail);
})();
