#!/usr/bin/env node
// Self-check for hooks/lib/render.js and hooks/lib/charts.js: page assembly,
// escaping, chart form selection, and coordinate safety.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderPage } = require('../hooks/lib/render.js');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  got === want ? ok(m) : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const has = (m, hay, needle) =>
  hay.includes(needle) ? ok(m) : bad(m, `missing ${JSON.stringify(needle)}`);
const lacks = (m, hay, needle) =>
  hay.includes(needle) ? bad(m, `unexpected ${JSON.stringify(needle)}`) : ok(m);

const Q = (options, extra = {}) => [{
  question: 'Which?', header: 'H', options, ...extra,
}];

console.log('1. bars form is unchanged');
{
  const page = renderPage(Q([
    { label: 'React', description: 'Big. {bundle:45, stars:220}' },
    { label: 'Svelte', description: 'Small. {bundle:12, stars:78}' },
  ]));
  has('largest value is a full-width bar', page, 'width:100.0%');
  has('per-key scale 12/45', page, 'width:26.7%');
  has('description keeps the tag stripped', page, 'Small.');
  lacks('tag never reaches the page', page, '{bundle:12');
}

console.log('2. the page shell');
{
  const page = renderPage(Q([
    { label: 'React', description: 'Big. {bundle:45}' },
    { label: 'Svelte', description: 'Small. {bundle:12}' },
  ]), { nonce: 'ab'.repeat(16), waitMs: 1000 });
  has('cards are buttons carrying their label', page, 'data-label="Svelte"');
  has('the footer offers send', page, 'id="send"');
  has('and offers handing back', page, 'id="cancel"');
}

console.log('3. escaping');
{
  const page = renderPage(Q([
    { label: '<script>bad()</script>', description: 'x {a:1}' },
    { label: 'ok', description: 'y {a:2}' },
  ], { question: '<img src=x onerror=alert(1)>' }));
  lacks('script tag escaped', page, '<script>bad()');
  lacks('img tag escaped', page, '<img src=x');
  has('rendered as escaped text', page, '&lt;img');
}

console.log('4. markup lives only in render.js');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'askq.js'), 'utf8');
  eq('askq.js has no stylesheet', src.includes('--accent'), false);
  eq('askq.js defines no esc', /const esc =/.test(src), false);
}

const { shapeOf, pickForm, renderChart } = require('../hooks/lib/charts.js');
const { prepareOptions } = require('../hooks/lib/render.js');

const prep = (options) => prepareOptions({ options });
const { scalesFor } = require('../hooks/lib/metrics.js');
const scaleOf = (options) => scalesFor(options.map((o) => o.metrics));

console.log('5. form selection and degradation');
{
  const three = prep([
    { label: 'A', description: 'a {chart: matrix, cost:$12, lat:40ms, risk:low}' },
    { label: 'B', description: 'b {cost:$6, lat:180ms, risk:high}' },
  ]);
  eq('matrix honoured with metrics', pickForm('matrix', three).name, 'matrix');
  eq('grouped honoured with metrics', pickForm('grouped', three).name, 'grouped');

  const one = prep([
    { label: 'A', description: 'a {cost:$12}' },
    { label: 'B', description: 'b {cost:$6}' },
  ]);
  eq('grouped honoured with 1 metric', pickForm('grouped', one).name, 'grouped');
  eq('matrix honoured with 1 metric', pickForm('matrix', one).name, 'matrix');

  const bare = prep([{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }]);
  eq('grouped degrades to bars with no metrics', pickForm('grouped', bare).name, 'bars');
  eq('matrix degrades to bars with no metrics', pickForm('matrix', bare).name, 'bars');

  eq('unknown form falls back to bars', pickForm('sunburst', three).name, 'bars');
  // A form this plugin used to draw is now just an unknown name, and an option
  // authored against an older rule must still render rather than throw.
  eq('a retired form falls back to bars', pickForm('radar', three).name, 'bars');
  eq('empty request falls back to bars', pickForm('', three).name, 'bars');
  eq('requested form is case-insensitive', pickForm('Matrix', three).name, 'matrix');

  eq('shape counts distinct keys', shapeOf(three).metrics, 3);
  eq('shape keeps declaration order', shapeOf(three).keys.join(','), 'cost,lat,risk');
}

console.log('6. grouped renderer');
{
  const options = prep([
    { label: 'React', description: 'a {chart: grouped, bundle:45}' },
    { label: 'Svelte', description: 'b {bundle:12}' },
  ]);
  const { name, shape } = pickForm('grouped', options);
  eq('form is grouped', name, 'grouped');
  const html = renderChart(name, options, scaleOf(options), shape);
  has('one block per metric key', html, '<h4>bundle</h4>');
  has('largest option is full width', html, 'width:100.0%');
  has('smaller option scaled', html, 'width:26.7%');
  has('series class applied', html, 'class="s0"');
  has('second series distinct', html, 'class="s1"');
  has('option label is the row key', html, 'React');
  has('raw value shown', html, '45');

  // Labels and keys are model-generated and reach the chart body directly.
  const evil = prep([
    { label: '<script>x()</script>', description: 'a {chart: grouped, "<b>":1}' },
    { label: 'ok', description: 'b {"<b>":2}' },
  ]);
  const e = pickForm('grouped', evil);
  const ehtml = renderChart(e.name, evil, scaleOf(evil), e.shape);
  lacks('a script tag in a label is escaped', ehtml, '<script>x()');
  has('it renders as text', ehtml, '&lt;script&gt;');
  lacks('a tag in a metric key is escaped too', ehtml, '<h4><b></h4>');
}

console.log('7. the page uses the requested form');
{
  const page = renderPage([{
    question: 'Which?',
    options: [
      { label: 'React', description: 'a {chart: grouped, bundle:45}' },
      { label: 'Svelte', description: 'b {bundle:12}' },
    ],
  }]);
  has('chart block present', page, 'class="chart grouped"');
  has('palette is defined', page, '--s0:');
  // Non-bars forms move the metrics out of the cards.
  eq('cards carry no metric rows',
    /<button type="button" class="card"[\s\S]*?class="metric"/.test(page), false);
}

console.log('8. matrix renderer');
{
  const options = prep([
    { label: 'A', description: 'a {chart: matrix, cost:$12, lat:40ms}' },
    { label: 'B', description: 'b {cost:$6, lat:180ms}' },
    { label: 'C', description: 'c {cost:$20}' },
  ]);
  const { name, shape } = pickForm('matrix', options);
  eq('form is matrix', name, 'matrix');
  const html = renderChart(name, options, scaleOf(options), shape);
  has('a column per key', html, '<th>cost</th>');
  has('second column', html, '<th>lat</th>');
  has('option label is a row header', html, '<th scope="row">A</th>');
  has('exact value in the cell', html, '$12');
  has('missing value is an em dash', html, '—');
  has('rank fill carries the series class', html, 'class="fill s0"');
  eq('one row per option', (html.match(/<tr><th scope="row">/g) || []).length, 3);

  const evil = prep([
    { label: '<img src=x onerror=y>', description: 'a {chart: matrix, cost:$1}' },
    { label: 'ok', description: 'b {cost:$2}' },
  ]);
  const e = pickForm('matrix', evil);
  const ehtml = renderChart(e.name, evil, scaleOf(evil), e.shape);
  lacks('a tag in a row header is escaped', ehtml, '<img src=x');
  has('it renders as text', ehtml, '&lt;img');
}

console.log('9. briefings');
{
  const page = renderPage([{
    question: 'Which?\n<!--brief-->\n## Today\n\n| stage | p99 |\n|---|---|\n| render | 710ms |',
    header: 'H',
    options: [
      { label: 'A', description: 'First. {cost:$1}\n<!--brief-->\n- **Pro:** cheap' },
      { label: 'B', description: 'Second. {cost:$2}' },
    ],
  }]);
  has('question briefing rendered', page, '<div class="brief">');
  has('question briefing content', page, '<h4>Today</h4>');
  has('question briefing table', page, '<table class="md-table">');
  has('option briefing rendered', page, '<div class="brief card-brief">');
  has('option briefing content', page, '<strong>Pro:</strong>');
  lacks('sentinel never reaches the page', page, '<!--brief-->');
  has('question heading is the stripped text', page, '<h2>Which?');

  // Placement: question briefing between the heading and the chart, option
  // briefing after the metric rows.
  const h2 = page.indexOf('</h2>');
  const qBrief = page.indexOf('<div class="brief">');
  const grid = page.indexOf('<div class="grid"');
  eq('question briefing sits after the heading', qBrief > h2, true);
  eq('question briefing sits before the cards', qBrief < grid, true);
  const bar = page.indexOf('class="metric"');
  eq('option briefing sits after the metric rows',
    page.indexOf('<div class="brief card-brief">') > bar, true);

  const bare = renderPage(Q([
    { label: 'A', description: 'First. {cost:$1}' },
    { label: 'B', description: 'Second. {cost:$2}' },
  ]));
  lacks('no briefing markup when absent', bare, 'class="brief"');
}

console.log('10. briefing without metrics');
{
  const page = renderPage([{
    question: 'Which?',
    header: 'H',
    options: [
      { label: 'A', description: 'First.\n<!--brief-->\n- only prose' },
      { label: 'B', description: 'Second.' },
    ],
  }]);
  const cardA = page.slice(page.indexOf('<h3>A</h3>'), page.indexOf('<h3>B</h3>'));
  has('briefed card renders its prose', cardA, '<li>only prose</li>');
  // Absent metrics are absent markup, briefed or not: the card is the summary.
  lacks('no missing-metrics notice anywhere', page, 'class="none"');

  const neither = renderPage(Q([{ label: 'A', description: 'First.' }]));
  lacks('an unbriefed card stays silent about it', neither, 'class="none"');
}

console.log('11. briefing escaping through renderPage');
{
  const page = renderPage([{
    question: 'Which?\n<!--brief-->\n<script>alert(1)</script>',
    header: 'H',
    options: [{ label: 'A', description: 'First.\n<!--brief-->\n<img onerror=x>' }],
  }]);
  lacks('no live script from a question briefing', page, '<script>alert(1)</script>');
  lacks('no live img from an option briefing', page, '<img onerror');
  has('question briefing escaped', page, '&lt;script&gt;');
  has('option briefing escaped', page, '&lt;img onerror=x&gt;');
}

console.log('12. every ending closes the page');
{
  const page = renderPage(Q([{ label: 'A', description: 'x. {c:1}' }]),
    { nonce: 'ab'.repeat(16), waitMs: 1000 });
  has('sending ends in the closing screen', page, "finish('Answer sent");
  has('handing back ends in it too', page, "finish('Answer this one");
  has('a vanished hook ends in it as well', page, 'no longer waiting');
  has('liveness is polled', page, "fetch('/ping')");
  has('the closing screen counts down', page, 'Closing in ');
  eq('one innerHTML write, and it interpolates nothing',
    (page.match(/innerHTML =/g) || []).length, 1);
}

console.log('13. the recommended badge');
{
  const page = renderPage(Q([
    { label: 'Keep it (Recommended)', description: 'x. {c:1}' },
    { label: 'Replace it', description: 'y. {c:2}' },
  ]), { nonce: 'ab'.repeat(16), waitMs: 1000 });
  has('the words become a badge', page, '<span class="rec">Recommended</span>');
  has('the heading loses them', page, '<h3>Keep it<span');
  has('the posted label keeps them', page, 'data-label="Keep it (Recommended)"');
  lacks('an unmarked option gets no badge', page,
    '<h3>Replace it<span class="rec"');
}

console.log('14. motion and hover');
{
  const page = renderPage(Q([{ label: 'A', description: 'x. {c:1}' }]),
    { nonce: 'ab'.repeat(16), waitMs: 1000 });
  has('one curve token feeds the transitions', page, '--ease:cubic-bezier');
  has('reduced motion kills both, pseudo-elements included', page,
    '*, *::before, *::after { animation:none !important; transition:none !important; }');
  has('reduced motion also stops smooth scrolling', page, 'scroll-behavior:auto');
  lacks('selecting a card shifts no text', page, 'padding-left:calc(1.1rem - 2px)');
}

console.log('15. mermaid loads only when a diagram is on the page');
{
  const withDiagram = (brief) => renderPage([{
    question: 'Which?\n<!--brief-->\n' + brief,
    header: 'H',
    options: [{ label: 'A', description: 'a {cost:$1}' }],
  }]);

  const diagram = withDiagram('```mermaid\nflowchart LR\n  A[x] --> B[y]\n```');
  has('the bundle is requested', diagram, '<script src="/mermaid.min.js">');
  // suppressErrors hides the exception, not the error card, so syntax is
  // checked with parse() and only what parses is handed to run().
  has('syntax is checked first', diagram, 'mermaid.parse(');
  has('run skips what failed to parse', diagram,
    "querySelector: '.mermaid:not([data-bad])'");
  has('errors are suppressed', diagram, 'suppressErrors: true');
  has('the sanitizer is on', diagram, "securityLevel: 'strict'");
  has('no html labels', diagram, 'htmlLabels: false');
  // 3.4MB is too much to fetch for a question that has no diagram in it.
  lacks('prose alone loads nothing', withDiagram('just prose'), 'mermaid.min.js');
  lacks('another language loads nothing',
    withDiagram('```js\nconst a = 1;\n```'), 'mermaid.min.js');
  lacks('no diagram, no init', withDiagram('just prose'), 'mermaid.initialize');

  // The block is readable before mermaid claims it, so a diagram that never
  // renders leaves its source on screen rather than an empty box.
  has('unprocessed blocks show their source', diagram,
    '.mermaid:not([data-processed])');
}

console.log('16. the vendored bundle is intact');
{
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const bundle = fs.readFileSync(require('node:path').join(__dirname, '..', 'vendor', 'mermaid.min.js'));
  eq('byte count matches vendor/README.md', bundle.length, 3572296);
  eq('sha256 matches vendor/README.md',
    crypto.createHash('sha256').update(bundle).digest('hex'),
    '8d8e0eec56d3a83b4b3c87f42050845546dee93ebe1875d2117c12e6947c0cb3');
  // A build that lazy-loads its diagram registry would 404 against the hook's
  // server and fail with no message, so one file has to be the whole library.
  eq('resolves no dynamic import', bundle.toString('latin1').split('import(').length - 1, 0);
  has('assigns the global a plain script tag can reach',
    bundle.toString('latin1').slice(-200), 'globalThis["mermaid"]');
}

console.log('17. trade-off lists on a card');
{
  const page = renderPage([{
    question: 'Which?',
    options: [
      { label: 'A', description: 'a {chart: matrix, cost:$12}<!--brief-->\n+ fast\n- untyped' },
      { label: 'B', description: 'b {cost:$6}<!--brief-->\n- ordinary\n- bullets' },
    ],
  }]);
  has('the marked run reaches the card', page, '<ul class="md-list procon">');
  has('a pro item', page, '<li class="pro">fast</li>');
  has('a con item', page, '<li class="con">untyped</li>');
  has('a dash-only run stays an ordinary list', page, '<ul class="md-list"><li>ordinary</li>');

  // The glyph is what carries the valence: red and green collapse under
  // deuteranopia, so a rule that only set a color would say nothing to a
  // reader who cannot separate them.
  has('the pro glyph is a plus', page, '.procon .pro::before { content:"+";');
  has('the con glyph is a true minus, not a hyphen', page, 'content:"\\2212"');
  has('both tokens are defined for light', page, '--pro:#046b34; --con:#b3261e;');
  has('and for dark', page, '--pro:#3fbf72; --con:#f2837a;');
  // One grid column for the glyph, so a pro and a con start their text at the
  // same x whatever the mix.
  has('the glyph gets its own column', page,
    '.procon li { display:grid; grid-template-columns:.95rem 1fr;');
  has('and the browser bullet is off', page, '.procon { list-style:none;');
}

console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail);
