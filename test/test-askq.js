#!/usr/bin/env node
// Self-check for askq.js. Stubs `open` with a fake browser that fetches
// the page and POSTs an answer, so no real browser launches.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'hooks', 'askq.js');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'askqclick-'));
let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(m)
    : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

// Fake browser: `open <url>` -> GET the page, then run a strategy against it.
// STRATEGY is read from the env of the hook's child, so it must be baked in.
function writeOpenStub(strategy) {
  const js = `
const http = require('node:http');
const url = process.argv[2];
const strategy = ${JSON.stringify(strategy)};
const u = new URL(url);
const nonce = u.searchParams.get('n');
http.get(url, (res) => {
  let html = '';
  res.on('data', (c) => (html += c));
  res.on('end', () => {
    require('node:fs').writeFileSync(${JSON.stringify(path.join(WORK, 'page.html'))}, html);
    if (strategy.action === 'ping') {
      return http.get(u.origin + '/ping', (r2) => {
        require('node:fs').writeFileSync(${JSON.stringify(path.join(WORK, 'ping.txt'))}, String(r2.statusCode));
      });
    }
    if (strategy.action === 'none') return;
    const route = { cancel: '/cancel', again: '/again' }[strategy.action] || '/answer';
    const body = strategy.oversized
      ? 'x'.repeat(70 * 1024)
      : JSON.stringify({
          nonce: strategy.action === 'badnonce' || strategy.badnonce ? 'deadbeef'.repeat(4) : nonce,
          picked: strategy.picked,
          other: strategy.other,
          notes: strategy.notes,
        });
    const req = http.request({
      hostname: u.hostname, port: u.port, path: route, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (r) => { require('node:fs').appendFileSync(${JSON.stringify(path.join(WORK, 'status.log'))}, r.statusCode + '\\n'); });
    req.on('error', () => {});
    req.end(body);
  });
}).on('error', () => {});
`;
  const jsPath = path.join(WORK, 'browser.js');
  fs.writeFileSync(jsPath, js);
  fs.writeFileSync(path.join(WORK, 'open'),
    `#!/bin/sh\nexec ${process.execPath} ${jsPath} "$1"\n`);
  fs.chmodSync(path.join(WORK, 'open'), 0o755);
}

function run(input, strategy, timeoutMs = 8000) {
  writeOpenStub(strategy);
  // Both are read back per run, so a stale file from the previous one would
  // read as this run's result.
  for (const f of ['status.log', 'page.html']) {
    try { fs.unlinkSync(path.join(WORK, f)); } catch {}
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      // Pin the launcher: a host with a working cmux would bypass the stub.
      env: { ...process.env, PATH: WORK + ':' + process.env.PATH, TMPDIR: WORK,
             CC_VISUALQ_OPEN: path.join(WORK, 'open') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', () => {
      clearTimeout(kill);
      const page = (() => { try { return fs.readFileSync(path.join(WORK, 'page.html'), 'utf8'); } catch { return ''; } })();
      const status = (() => { try { return fs.readFileSync(path.join(WORK, 'status.log'), 'utf8').trim(); } catch { return ''; } })();
      resolve({ out, json: (() => { try { return JSON.parse(out); } catch { return null; } })(), page, status });
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

const Q_SINGLE = {
  tool_input: { questions: [{
    question: 'Which framework?', header: 'FW',
    options: [
      { label: 'React', description: 'Big. {bundle:45}' },
      { label: 'Svelte', description: 'Small. {bundle:12}' },
    ],
  }] },
};

(async () => {
  console.log('1. click answers the tool: allow + answers map');
  let r = await run(Q_SINGLE, { action: 'post', picked: { 0: ['Svelte'] } });
  const hso = r.json?.hookSpecificOutput;
  eq('permissionDecision allow', hso?.permissionDecision, 'allow');
  eq('answers maps question -> label', hso?.updatedInput?.answers,
    { 'Which framework?': 'Svelte' });
  eq('questions echoed back', hso?.updatedInput?.questions?.length, 1);
  eq('metric tag stripped', hso?.updatedInput?.questions[0].options[0].description, 'Big.');
  eq('POST accepted (204)', r.status, '204');
  r.page.includes('data-label="Svelte"') ? ok('cards are clickable buttons')
    : bad('clickable cards', 'no data-label button in page');
  r.page.includes('width:26.7%') ? ok('per-key bar scale (12/45)')
    : bad('bar scale', 'no 26.7% bar');

  console.log('2. wrong nonce is rejected, no answer emitted');
  r = await run(Q_SINGLE, { action: 'badnonce', picked: { 0: ['React'] } });
  eq('403 on bad nonce', r.status, '403');
  eq('no decision emitted', r.out, '');

  console.log('3. label not in options is refused (no invented answers)');
  r = await run(Q_SINGLE, { action: 'post', picked: { 0: ['Angular'] } });
  eq('no decision for unknown label', r.out, '');

  console.log('4. multiSelect joins labels with commas');
  r = await run({ tool_input: { questions: [{
    question: 'Which features?', header: 'F', multiSelect: true,
    options: [{ label: 'A', description: 'a {x:1}' }, { label: 'B', description: 'b {x:2}' },
              { label: 'C', description: 'c {x:3}' }],
  }] } }, { action: 'post', picked: { 0: ['A', 'C'] } });
  eq('comma-joined', r.json?.hookSpecificOutput?.updatedInput?.answers,
    { 'Which features?': 'A, C' });

  console.log('5. partial answer on 2 questions -> no decision (dialog takes over)');
  const TWO = { tool_input: { questions: [
    { question: 'Q1?', options: [{ label: 'a', description: '{x:1}' }] },
    { question: 'Q2?', options: [{ label: 'b', description: '{x:2}' }] },
  ] } };
  r = await run(TWO, { action: 'post', picked: { 0: ['a'] } });
  eq('partial rejected', r.out, '');
  console.log('   both answered ->');
  r = await run(TWO, { action: 'post', picked: { 0: ['a'], 1: ['b'] } });
  eq('both answered accepted', r.json?.hookSpecificOutput?.updatedInput?.answers,
    { 'Q1?': 'a', 'Q2?': 'b' });

  console.log('6. HTML injection escaped in served page');
  r = await run({ tool_input: { questions: [{
    question: '<img src=x onerror=alert(1)>',
    options: [{ label: '<script>bad()</script>', description: 'x {a:1}' },
              { label: 'ok', description: 'y {a:2}' }],
  }] } }, { action: 'none' }, 3000);
  r.page.includes('<script>bad()') ? bad('script escaped', 'raw <script> in page') : ok('script escaped');
  r.page.includes('<img src=x') ? bad('question escaped', 'raw <img> in page') : ok('question escaped');
  r.page.includes('&lt;img') ? ok('rendered as escaped text') : bad('escaped text', 'missing');

  console.log('7. malformed input -> no decision, no hang');
  for (const b of ['not json', '{}', '{"tool_input":{}}', '{"tool_input":{"questions":[]}}']) {
    const rr = await run(b, { action: 'none' }, 3000);
    rr.out === '' ? ok('no-op: ' + b) : bad('no-op: ' + b, 'emitted ' + rr.out);
  }

  console.log('8. no click -> exits without answering (dialog fallback)');
  r = await run(Q_SINGLE, { action: 'none' }, 3000);
  eq('silent when unanswered', r.out, '');

  // Regression: a rejected POST once hung for the full WAIT_MS, stalling the
  // terminal dialog behind a browser that already had its turn.
  console.log('9. rejected POST exits promptly, does not hold the dialog');
  for (const { name, strategy } of [
    { name: 'bad nonce', strategy: { action: 'badnonce', picked: { 0: ['React'] } } },
    { name: 'unknown label', strategy: { action: 'post', picked: { 0: ['Angular'] } } },
  ]) {
    const t0 = Date.now();
    const rr = await run(Q_SINGLE, strategy, 15000);
    const secs = (Date.now() - t0) / 1000;
    rr.out === '' && secs < 10
      ? ok(`${name}: exited in ${secs.toFixed(1)}s without answering`)
      : bad(`${name} prompt exit`, `elapsed ${secs.toFixed(1)}s out=[${rr.out}]`);
  }

  const ONE_Q = JSON.stringify({ tool_input: { questions: [{
    question: 'Which?', header: 'H', options: [
      { label: 'React', description: 'Big. {bundle:45}' },
      { label: 'Svelte', description: 'Small. {bundle:12}' },
    ],
  }] } });

  console.log('10. free text answers the question verbatim');
  {
    const r = await run(ONE_Q, { action: 'post', picked: {}, other: { 0: 'Neither, use Solid' } });
    const ui = r.json?.hookSpecificOutput?.updatedInput;
    eq('decision is allow', r.json?.hookSpecificOutput?.permissionDecision, 'allow');
    eq('free text is the answer', ui?.answers?.['Which?'], 'Neither, use Solid');
    eq('questions still echoed whole', ui?.questions?.[0]?.options?.length, 2);
  }

  console.log('11. notes ride along as annotations');
  {
    const r = await run(ONE_Q, {
      action: 'post', picked: { 0: ['Svelte'] }, notes: { 0: 'only if the migration lands' },
    });
    const ui = r.json?.hookSpecificOutput?.updatedInput;
    eq('label is the answer', ui?.answers?.['Which?'], 'Svelte');
    eq('notes reach annotations', ui?.annotations?.['Which?']?.notes, 'only if the migration lands');
  }

  console.log('12. no notes means no annotations key');
  {
    const r = await run(ONE_Q, { action: 'post', picked: { 0: ['Svelte'] } });
    eq('annotations omitted', 'annotations' in (r.json?.hookSpecificOutput?.updatedInput || {}), false);
  }

  console.log('13. text is capped at 2000 characters');
  {
    const r = await run(ONE_Q, { action: 'post', picked: {}, other: { 0: 'x'.repeat(2500) } });
    eq('answer truncated to the cap',
      r.json?.hookSpecificOutput?.updatedInput?.answers?.['Which?']?.length, 2000);
  }

  console.log('14. whitespace-only free text is not an answer');
  {
    const r = await run(ONE_Q, { action: 'post', picked: {}, other: { 0: '   ' } });
    eq('nothing emitted', r.out, '');
    eq('POST accepted', r.status, '204');
  }

  console.log('15. cancel emits nothing and hands back to the dialog');
  {
    const t0 = Date.now();
    const r = await run(ONE_Q, { action: 'cancel' });
    const secs = (Date.now() - t0) / 1000;
    eq('no decision written', r.out, '');
    eq('cancel accepted', r.status, '204');
    secs < 10 ? ok(`exited in ${secs.toFixed(1)}s without hanging`)
      : bad('prompt exit', `elapsed ${secs.toFixed(1)}s`);
  }

  console.log('16. a question with no tag and no briefing opens no page');
  {
    const r = await run({ tool_input: { questions: [{
      question: 'Ship it?', header: 'S',
      options: [{ label: 'Yes', description: 'Ship now.' },
                { label: 'No', description: 'Hold.' }],
    }] } }, { action: 'post', picked: { 0: ['Yes'] } }, 6000);
    eq('no decision emitted', r.out, '');
    eq('no page served', r.page, '');
  }

  console.log('17. the page offers text entry, notes, and cancel');
  {
    const r = await run(ONE_Q, { action: 'none' });
    r.page.includes('class="card other"') ? ok('other input present')
      : bad('other input', 'no .other in page');
    r.page.includes('class="notes"') ? ok('notes textarea present')
      : bad('notes', 'no .notes in page');
    r.page.includes('id="cancel"') ? ok('cancel button present')
      : bad('cancel', 'no #cancel in page');
    r.page.includes('id="again"') ? ok('ask-again button present')
      : bad('again', 'no #again in page');
    r.page.includes('maxlength="2000"') ? ok('length capped in the page too')
      : bad('maxlength', 'no maxlength on the inputs');
  }

  console.log('18. oversized POST body exits promptly, does not hold the dialog');
  {
    const t0 = Date.now();
    const rr = await run(Q_SINGLE, { action: 'post', oversized: true }, 15000);
    const secs = (Date.now() - t0) / 1000;
    rr.out === '' && secs < 10
      ? ok(`exited in ${secs.toFixed(1)}s without answering`)
      : bad('prompt exit on oversized body', `elapsed ${secs.toFixed(1)}s out=[${rr.out}]`);
    // A hang would also leave nothing written; only the elapsed-time check
    // above distinguishes that from a SIGKILL, so both must be asserted.
    rr.status === '413' ? ok('oversized body rejected with 413')
      : bad('413 on oversized body', `got status=[${rr.status}]`);
  }

  console.log('19. first chart declaration wins; later ones are ignored');
  {
    const Q = { tool_input: { questions: [{
      question: 'Which?', header: 'H',
      options: [
        { label: 'A', description: 'a {cost:$12}' },
        { label: 'B', description: 'b {chart: grouped, cost:$6}' },
        { label: 'C', description: 'c {chart: matrix, cost:$20}' },
      ],
    }] } };
    const r = await run(Q, { action: 'none' }, 3000);
    r.page.includes('class="chart grouped"') ? ok('first declared form (grouped) wins')
      : bad('first chart wins', 'grouped chart block missing from page');
    r.page.includes('<table class="matrix"') ? bad('later chart ignored', 'matrix table rendered anyway')
      : ok('later chart declaration (matrix) ignored');
  }

  console.log('20. multi-select plus free text joins labels first, typed text last');
  {
    const r = await run({ tool_input: { questions: [{
      question: 'Which features?', header: 'F', multiSelect: true,
      options: [{ label: 'A', description: 'a {x:1}' }, { label: 'B', description: 'b {x:2}' }],
    }] } }, { action: 'post', picked: { 0: ['A', 'B'] }, other: { 0: 'my own caveat' } });
    eq('labels first, free text last', r.json?.hookSpecificOutput?.updatedInput?.answers,
      { 'Which features?': 'A, B, my own caveat' });
  }

  console.log('21. a briefed question answers keyed to the stripped question text');
  {
    const Q = { tool_input: { questions: [{
      question: 'Which framework?\n<!--brief-->\nbundle size dominates.', header: 'FW',
      options: [
        { label: 'React', description: 'Big.' },
        { label: 'Svelte', description: 'Small.' },
      ],
    }] } };
    const r = await run(Q, { action: 'post', picked: { 0: ['Svelte'] } });
    const answers = r.json?.hookSpecificOutput?.updatedInput?.answers;
    eq('answer key is the stripped question, not the raw one',
      Object.keys(answers || {}), ['Which framework?']);
    eq('label is the value', answers?.['Which framework?'], 'Svelte');
  }

  console.log('22. ask again blocks the call and tells the model to go deeper');
  {
    const r = await run(ONE_Q, { action: 'again' });
    const hso = r.json?.hookSpecificOutput;
    eq('decision is deny', hso?.permissionDecision, 'deny');
    eq('no answer invented', 'updatedInput' in (hso || {}), false);
    eq('POST accepted (204)', r.status, '204');
    const why = hso?.permissionDecisionReason || '';
    /ask it again/i.test(why) ? ok('reason directs a re-ask')
      : bad('reason directs a re-ask', `got [${why}]`);
    /mermaid/.test(why) && /matrix/.test(why) ? ok('reason names the richer forms')
      : bad('reason names the richer forms', `got [${why}]`);
  }

  console.log('23. ask again with a wrong nonce emits nothing');
  {
    const r = await run(ONE_Q, { action: 'again', badnonce: true });
    eq('403 on bad nonce', r.status, '403');
    eq('no decision emitted', r.out, '');
  }

  // The page polls this to notice an aborted hook instead of waiting out the
  // full deadline; if it 404s the page would think the hook had died.
  {
    const Q = { tool_input: { questions: [{
      question: 'Which?', header: 'H',
      options: [{ label: 'A', description: 'x. {c:1}' }, { label: 'B', description: 'y. {c:2}' }],
    }] } };
    const r = await run(Q, { action: 'ping' });
    const status = fs.existsSync(path.join(WORK, 'ping.txt'))
      ? fs.readFileSync(path.join(WORK, 'ping.txt'), 'utf8') : '(never requested)';
    eq('liveness route answers 204 while the hook waits', status, '204');
    eq('and the hook still falls through when nobody answers',
      r.json?.hookSpecificOutput?.permissionDecision ?? null, null);
  }

  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
  process.exit(fail);
})();
