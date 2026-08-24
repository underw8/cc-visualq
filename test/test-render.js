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
    { label: 'A', description: 'a {chart: radar, cost:$12, lat:40ms, risk:low}' },
    { label: 'B', description: 'b {cost:$6, lat:180ms, risk:high}' },
  ]);
  eq('radar honoured with 3 numeric axes', pickForm('radar', three).name, 'radar');

  const two = prep([
    { label: 'A', description: 'a {cost:$12, lat:40ms}' },
    { label: 'B', description: 'b {cost:$6, lat:180ms}' },
  ]);
  eq('radar degrades to matrix below 3 axes', pickForm('radar', two).name, 'matrix');
  eq('scatter honoured with 2 numeric', pickForm('scatter', two).name, 'scatter');

  const one = prep([
    { label: 'A', description: 'a {cost:$12}' },
    { label: 'B', description: 'b {cost:$6}' },
  ]);
  eq('scatter degrades to grouped with 1 metric', pickForm('scatter', one).name, 'grouped');
  eq('grouped honoured with 1 metric', pickForm('grouped', one).name, 'grouped');

  const bare = prep([{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }]);
  eq('grouped degrades to bars with no metrics', pickForm('grouped', bare).name, 'bars');
  eq('matrix degrades to bars with no metrics', pickForm('matrix', bare).name, 'bars');
  eq('scatter degrades all the way to bars', pickForm('scatter', bare).name, 'bars');
  eq('radar degrades all the way to bars', pickForm('radar', bare).name, 'bars');

  eq('unknown form falls back to bars', pickForm('sunburst', three).name, 'bars');
  eq('empty request falls back to bars', pickForm('', three).name, 'bars');
  eq('requested form is case-insensitive', pickForm('Radar', three).name, 'radar');

  eq('shape counts distinct keys', shapeOf(three).metrics, 3);
  eq('shape counts axis-capable keys', shapeOf(three).completeNumeric.length, 3);

  // An axis-per-key form is gated on the shortest bar it would draw: a vertex
  // at 2% of the radius sits where a missing value sits. The gate needs the
  // scale, and opens without one so a caller that omits it degrades to the
  // old behaviour rather than losing every chart.
  const wide = prep([
    { label: 'A', description: 'a {size:3.4mb, setup:2h, risk:low}' },
    { label: 'B', description: 'b {size:170mb, setup:4h, risk:critical}' },
  ]);
  eq('radar refuses a 50x spread', pickForm('radar', wide, scaleOf(wide)).name, 'matrix');
  eq('radar keeps it without a scale', pickForm('radar', wide).name, 'radar');

  const near = prep([
    { label: 'A', description: 'a {size:60mb, setup:2h, risk:low}' },
    { label: 'B', description: 'b {size:170mb, setup:4h, risk:critical}' },
  ]);
  eq('radar keeps a 3x spread', pickForm('radar', near, scaleOf(near)).name, 'radar');

  const wide2 = prep([
    { label: 'A', description: 'a {size:3.4mb, setup:2h}' },
    { label: 'B', description: 'b {size:170mb, setup:4h}' },
  ]);
  eq('scatter refuses it too', pickForm('scatter', wide2, scaleOf(wide2)).name, 'grouped');
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
}

console.log('9. coordinate clamping');
{
  const { num } = require('../hooks/lib/charts.js');
  eq('NaN becomes the floor', num(Number.NaN, 5, 100), 5);
  eq('Infinity is clamped', num(Infinity, 5, 100), 100);
  eq('-Infinity is clamped', num(-Infinity, 5, 100), 5);
  eq('undefined becomes the floor', num(undefined, 5, 100), 5);
  eq('a string number is clamped', num('7', 5, 100), 7);
  eq('a non-numeric string becomes the floor', num('abc', 5, 100), 5);
  eq('below range clamps up', num(-3, 5, 100), 5);
  eq('above range clamps down', num(999, 5, 100), 100);
  eq('rounded to 2 decimals', num(7.129, 5, 100), 7.13);
}

console.log('10. scatter renderer');
{
  const options = prep([
    { label: 'A', description: 'a {chart: scatter, cost:$20, lat:40ms}' },
    { label: 'B', description: 'b {cost:$5, lat:180ms}' },
  ]);
  const { name, shape } = pickForm('scatter', options);
  eq('form is scatter', name, 'scatter');
  const html = renderChart(name, options, scaleOf(options), shape);
  has('svg emitted', html, '<svg viewBox="0 0 640 360"');
  has('axis label names the first numeric key', html, '>cost<');
  has('axis label names the second', html, '>lat<');
  eq('one point per option', (html.match(/<circle /g) || []).length, 2);
  has('points carry a series class', html, '<circle class="s0"');
  eq('no non-finite coordinate reaches an attribute', /="(NaN|Infinity|-Infinity)"/.test(html), false);

  // Three references per axis, and the value each axis tops out at. Both axes
  // are normalized to their own key's largest value, so naming that value is
  // the whole of the scale — every other position is a fraction of it.
  eq('three gridlines per axis', (html.match(/class="gridline"/g) || []).length, 6);
  eq('one tick per axis', (html.match(/class="atick"/g) || []).length, 2);
  has('the x tick is the largest cost, as authored', html, '>$20<');
  has('the y tick is the largest latency, as authored', html, '>180ms<');
  // An ordinal axis ranks by its word's position in the vocabulary, so the tick
  // has to name the highest word rather than the largest number.
  const ord = prep([
    { label: 'A', description: 'a {chart: scatter, cost:$20, risk:low}' },
    { label: 'B', description: 'b {cost:$5, risk:critical}' },
  ]);
  const o = pickForm('scatter', ord, scaleOf(ord));
  has('an ordinal axis ticks its highest word',
    renderChart(o.name, ord, scaleOf(ord), o.shape), '>critical<');
  // Data over grid, never under it.
  eq('the grid is drawn first',
    html.indexOf('class="gridline"') < html.indexOf('<circle '), true);
}

console.log('10b. scatter degrades when an option is missing an axis');
{
  // B has no `lat`: honouring scatter here would drop B's point from the
  // chart, and since non-bars forms hide the card metric rows too, B's
  // `cost` would then appear nowhere on the page.
  const options = prep([
    { label: 'A', description: 'a {chart: scatter, cost:$20, lat:40ms}' },
    { label: 'B', description: 'b {cost:$5}' },
  ]);
  const { name } = pickForm('scatter', options);
  eq('scatter is not honoured when an option lacks an axis', name, 'grouped');
}

console.log('11. svg labels are escaped');
{
  const options = prep([
    { label: '<script>x()</script>', description: 'a {chart: scatter, cost:$20, lat:40ms}' },
    { label: 'ok', description: 'b {cost:$5, lat:180ms}' },
  ]);
  const { name, shape } = pickForm('scatter', options);
  const html = renderChart(name, options, scaleOf(options), shape);
  lacks('script tag escaped inside svg', html, '<script>x()');
  has('rendered as escaped text', html, '&lt;script&gt;');
}

console.log('12. radar renderer');
{
  const options = prep([
    { label: 'A', description: 'a {chart: radar, cost:$20, lat:40ms, risk:low}' },
    { label: 'B', description: 'b {cost:$5, lat:180ms, risk:high}' },
  ]);
  const { name, shape } = pickForm('radar', options);
  eq('form is radar', name, 'radar');
  const html = renderChart(name, options, scaleOf(options), shape);
  // Rings are polygons too, so the data polygons are counted by their class.
  eq('one data polygon per option', (html.match(/class="poly /g) || []).length, 2);
  eq('one axis line per numeric key', (html.match(/<line class="axis"/g) || []).length, 3);
  has('axis labelled', html, '>cost<');
  has('polygon carries a series class', html, 'class="poly s1"');
  has('legend lists the options', html, 'class="legend"');
  eq('no non-finite coordinate reaches an attribute', /="[^"]*(NaN|Infinity)/.test(html), false);
  // Three axes, two options: six "x,y" pairs across the two polygons.
  eq('three points per polygon',
    (html.match(/points="[^"]*"/g) || []).every((p) => p.split(' ').length === 3), true);

  // Four rings, and no number on any of them: each axis is normalized to its
  // own key's largest value, so one radius stands for a different quantity per
  // spoke and a radial tick would be true of at most one. The vertices carry
  // the values instead.
  eq('four concentric rings', (html.match(/class="gridline"/g) || []).length, 4);
  eq('the rings carry no ticks', (html.match(/class="atick"/g) || []).length, 0);
  eq('the rings are drawn first',
    html.indexOf('class="gridline"') < html.indexOf('class="poly '), true);

  // A key name anchored in the middle reaches back along its own axis into the
  // value label sitting just past r. Anchoring it outward is what keeps twenty
  // labels apart on a four-option, four-axis chart — the most the tool can
  // produce. Three axes point up, down-right and down-left.
  // Scoped to the key names: the vertex value labels are centred too.
  const anchors = (src, kind) =>
    (src.match(new RegExp(`class="alabel"[^>]*text-anchor="${kind}"`, 'g')) || []).length;
  eq('a near-vertical axis keeps the middle anchor', anchors(html, 'middle'), 1);
  eq('a rightward axis anchors at the start', anchors(html, 'start'), 1);
  eq('a leftward axis anchors at the end', anchors(html, 'end'), 1);

  const four = prep([
    { label: 'A', description: 'a {chart: radar, w:1, x:2, y:3, z:low}' },
    { label: 'B', description: 'b {w:2, x:1, y:4, z:high}' },
  ]);
  const f = pickForm('radar', four);
  const fhtml = renderChart(f.name, four, scaleOf(four), f.shape);
  // Four axes point up, right, down and left: two vertical, one each side.
  eq('four axes split two vertical and one per side',
    ['middle', 'start', 'end'].map((k) => anchors(fhtml, k)).join(','), '2,1,1');
}

console.log('13. radar degrades when an option is missing an axis');
{
  // B has no `risk`. Plotting it at the centre would read as the best risk of
  // the two rather than as no data, so the axis set drops below three and the
  // question falls to matrix, which shows the gap as an em dash.
  const options = prep([
    { label: 'A', description: 'a {chart: radar, cost:$20, lat:40ms, risk:low}' },
    { label: 'B', description: 'b {cost:$5, lat:180ms}' },
  ]);
  const { name, shape } = pickForm('radar', options);
  eq('radar is not honoured when an option lacks an axis', name, 'matrix');
  const html = renderChart(name, options, scaleOf(options), shape);
  has('the gap is shown, not plotted as zero', html, '—');
  eq('no polygon is drawn', (html.match(/<polygon /g) || []).length, 0);

  // Three axes all four options carry: radar still stands.
  const full = prep([
    { label: 'A', description: 'a {chart: radar, cost:$20, lat:40ms, risk:low}' },
    { label: 'B', description: 'b {cost:$5, lat:180ms, risk:high}' },
  ]);
  const picked = pickForm('radar', full);
  eq('a complete axis set is still honoured', picked.name, 'radar');
  const svg = renderChart(picked.name, full, scaleOf(full), picked.shape);
  eq('no vertex sits at the centre',
    svg.includes('320,180'), false);
}

console.log('14. briefings');
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

console.log('15. briefing without metrics');
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

console.log('16. briefing escaping through renderPage');
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

console.log('17. every ending closes the page');
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

console.log('18. the recommended badge');
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

console.log('19. motion and hover');
{
  const page = renderPage(Q([{ label: 'A', description: 'x. {c:1}' }]),
    { nonce: 'ab'.repeat(16), waitMs: 1000 });
  has('one curve token feeds the transitions', page, '--ease:cubic-bezier');
  has('reduced motion kills both, pseudo-elements included', page,
    '*, *::before, *::after { animation:none !important; transition:none !important; }');
  has('reduced motion also stops smooth scrolling', page, 'scroll-behavior:auto');
  lacks('selecting a card shifts no text', page, 'padding-left:calc(1.1rem - 2px)');
}

console.log('20. mermaid loads only when a diagram is on the page');
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

console.log('21. the vendored bundle is intact');
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

console.log('22. no SVG mark class doubles as a DOM class');
{
  // Both owners write into one stylesheet, so a name used in charts.js and in
  // render.js gets both rule bodies. It survived twice by luck — stroke is
  // inert on a div and display:grid is inert on a polygon — and would stop
  // surviving the first time either rule grew a property the other shares.
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'hooks', 'lib', f), 'utf8');
  // A class list can end in an interpolated slot (`class="poly \${seriesClass(i)}"`),
  // so tokens carrying template syntax are dropped rather than the whole list.
  const names = (src, re) => new Set([...src.matchAll(re)]
    .flatMap((m) => m[m.length - 1].trim().split(/\s+/))
    .filter((c) => c && !/[${}]/.test(c)));
  // Only classes on SVG geometry and text: HTML classes are shared on purpose
  // (`grouped` reuses the card's bar markup), and the series slots s0-s3 are
  // shared by design — one --c property, read by every mark.
  const marks = names(read('charts.js'),
    /<(?:line|polygon|circle|text|path)[^>]*class="([^"]+)"/g);
  const dom = names(read('render.js'), /class="([^"]+)"/g);
  for (const slot of ['s0', 's1', 's2', 's3']) marks.delete(slot);
  eq('no SVG mark class is also a DOM class',
    [...marks].filter((c) => dom.has(c)).join(',') || 'none', 'none');
  eq('the marks are the ones we expect', [...marks].sort().join(','),
    'alabel,atick,axis,gridline,plabel,poly,vlabel');
}

console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail);
