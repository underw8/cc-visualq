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
  eq('one polygon per option', (html.match(/<polygon /g) || []).length, 2);
  eq('one axis line per numeric key', (html.match(/<line class="axis"/g) || []).length, 3);
  has('axis labelled', html, '>cost<');
  has('polygon carries a series class', html, 'class="poly s1"');
  has('legend lists the options', html, 'class="legend"');
  eq('no non-finite coordinate reaches an attribute', /="[^"]*(NaN|Infinity)/.test(html), false);
  // Three axes, two options: six "x,y" pairs across the two polygons.
  eq('three points per polygon',
    (html.match(/points="[^"]*"/g) || []).every((p) => p.split(' ').length === 3), true);
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
  // Scoped to A's own card: suppression is per-card (the brief attaches to
  // one option), so B — unbriefed, in the same question — must still report.
  const cardA = page.slice(page.indexOf('<h3>A</h3>'), page.indexOf('<h3>B</h3>'));
  has('briefed card renders its prose', cardA, '<li>only prose</li>');
  lacks('briefed card suppresses its own no-metrics line', cardA,
    '<p class="none">no metrics supplied</p>');
  has('unbriefed sibling still reports missing metrics', page,
    '<p class="none">no metrics supplied</p>');

  const neither = renderPage(Q([{ label: 'A', description: 'First.' }]));
  has('an unbriefed card still says so', neither,
    '<p class="none">no metrics supplied</p>');
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

console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail);
