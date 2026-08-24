#!/usr/bin/env node
// Self-check for hooks/lib/metrics.js: unit normalization, ordinals, scaling.
'use strict';

const { parseMetrics, scalesFor, barPercent, parseValue } =
  require('../hooks/lib/metrics.js');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  got === want ? ok(m) : bad(m, `expected ${want} got ${got}`);
const close = (m, got, want) =>
  Math.abs(got - want) < 0.05 ? ok(m) : bad(m, `expected ~${want} got ${got}`);

console.log('1. unit-aware magnitudes');
eq('4mb > 12kb', parseValue('4mb').value > parseValue('12kb').value, true);
eq('1.5s > 250ms', parseValue('1.5s').value > parseValue('250ms').value, true);
eq('1gb == 1024mb', parseValue('1gb').value === parseValue('1024mb').value, true);
eq('$4.2k parses', parseValue('$4.2k').value, 4200);
eq('1,200 keeps separator', parseValue('1,200').value, 1200);
eq('80% parses', parseValue('80%').value, 80);
eq('-3 stays negative', parseValue('-3').value, -3);
eq('bare 12 unitless', parseValue('12').dimension, null);
eq('unknown suffix is unitless number', parseValue('40req').value, 40);

console.log('2. ordinals rank');
eq('low < high', parseValue('low').value < parseValue('high').value, true);
eq('medium between', parseValue('medium').value > parseValue('low').value
  && parseValue('medium').value < parseValue('high').value, true);
eq('critical is top', parseValue('critical').value, 5);
eq('case-insensitive', parseValue('HIGH').value, parseValue('high').value);
eq('unknown word is text', parseValue('bananas').kind, 'text');
eq('text has no value', parseValue('bananas').value, null);

console.log('3. tag parsing');
let p = parseMetrics('Small and fast. {bundle:12kb, latency:250ms}');
eq('description cleaned', p.clean, 'Small and fast.');
eq('two metrics', p.metrics.length, 2);
eq('key parsed', p.metrics[0].key, 'bundle');
eq('raw preserved for display', p.metrics[0].raw, '12kb');
eq('no tag -> no metrics', parseMetrics('Just text.').metrics.length, 0);
eq('no tag -> clean passthrough', parseMetrics('Just text.').clean, 'Just text.');

// A thousands separator must not be read as the pair delimiter, and must not
// silently drop the rest of the number.
const commaTag = parseMetrics('x {cost:$1,200, risk:low}');
eq('comma in value keeps one metric per pair', commaTag.metrics.length, 2);
eq('comma value parsed whole', commaTag.metrics[0].value, 1200);
eq('comma value displayed whole', commaTag.metrics[0].raw, '$1,200');
eq('following pair intact', commaTag.metrics[1].key, 'risk');
const multiComma = parseMetrics('x {big:1,234,567, n:2}');
eq('multiple separators', multiComma.metrics[0].value, 1234567);
eq('pair after multi-separator', multiComma.metrics[1].key, 'n');

console.log('4. per-key scaling across options');
const opts = [
  parseMetrics('a {size:4mb, wait:250ms}').metrics,
  parseMetrics('b {size:12kb, wait:1.5s}').metrics,
];
const scale = scalesFor(opts);
// 4mb is the larger size, so it is full width and 12kb is a sliver.
close('4mb bar is 100%', barPercent(opts[0][0], scale), 100);
close('12kb bar is tiny', barPercent(opts[1][0], scale), 2);
// 1.5s beats 250ms.
close('1.5s bar is 100%', barPercent(opts[1][1], scale), 100);
close('250ms bar is ~16.7%', barPercent(opts[0][1], scale), 16.67);

console.log('5. ordinal bars scale against the vocabulary, not the options');
const ordOpts = [
  parseMetrics('a {risk:low}').metrics,
  parseMetrics('b {risk:high}').metrics,
];
const ordScale = scalesFor(ordOpts);
close('high risk is 80%', barPercent(ordOpts[1][0], ordScale), 80);
// A lone `low` still draws a short bar rather than nothing.
const soloScale = scalesFor([parseMetrics('a {risk:low}').metrics]);
close('lone low still draws', barPercent(parseMetrics('a {risk:low}').metrics[0], soloScale), 40);

console.log('6. mixed units under one key fall back to raw numbers');
const mixed = [
  parseMetrics('a {span:4mb}').metrics,
  parseMetrics('b {span:2s}').metrics,
];
scalesFor(mixed);
eq('dimension cleared on conflict', mixed[0][0].dimension, null);

console.log('7. ambiguous unit adopts its siblings dimension');
const dur = [
  parseMetrics('a {t:30m}').metrics,   // minutes, not megabytes
  parseMetrics('b {t:2h}').metrics,
];
scalesFor(dur);
eq('30m read as minutes', dur[0][0].value, 1_800_000);
eq('2h > 30m', dur[1][0].value > dur[0][0].value, true);

const cnt = [
  parseMetrics('a {stars:2m}').metrics,   // millions, not minutes
  parseMetrics('b {stars:500k}').metrics,
];
scalesFor(cnt);
eq('2m read as millions', cnt[0][0].value, 2e6);

console.log('8. text metrics render without a bar');
const txt = parseMetrics('a {support:bananas}').metrics;
eq('no bar for text', barPercent(txt[0], scalesFor([txt])), 0);
eq('raw still displayable', txt[0].raw, 'bananas');

console.log('9. the reserved chart key');
{
  const p = parseMetrics('Fast. {chart: matrix, cost:$12, latency:40ms}');
  eq('chart extracted', p.chart, 'matrix');
  eq('chart absent from metrics', p.metrics.some((m) => m.key === 'chart'), false);
  eq('sibling metrics survive', p.metrics.length, 2);
  eq('description still cleaned', p.clean, 'Fast.');

  const trailing = parseMetrics('Fast. {cost:$12, chart:matrix}');
  eq('position does not matter', trailing.chart, 'matrix');
  eq('one metric left', trailing.metrics.length, 1);

  const none = parseMetrics('Fast. {cost:$12}');
  eq('absent chart is empty string', none.chart, '');

  const junk = parseMetrics('Fast. {chart: sunburst, cost:$12}');
  eq('unrecognized value passes through untouched', junk.chart, 'sunburst');

  eq('no tag at all still yields a chart field', parseMetrics('Just text.').chart, '');
}

console.log('a rate period does not cost the bar');
{
  // `$12/mo` is the first example in hooks/askq-rule.md, so an option authored
  // straight from the rule must rank rather than fall through to text.
  const rate = parseValue('$12/mo');
  eq('a rate parses as a number', rate.kind, 'number');
  eq('the period is dropped, the magnitude kept', rate.value, 12);
  eq('a unit before the period still scales', parseValue('2.5k/mo').value, 2500);
  eq('so does a size', parseValue('120kb/s').value, 122880);
  eq('a bare slash is still text', parseValue('a/b').kind, 'text');
  eq('a dangling slash is still text', parseValue('12/').kind, 'text');
}

console.log('10. briefings');
{
  const { splitBrief, stripTags } = require('../hooks/lib/metrics.js');

  const none = splitBrief('Plain description.');
  eq('no sentinel keeps text', none.text, 'Plain description.');
  eq('no sentinel means no brief', none.brief, '');

  const split = splitBrief('Fast. {cost:$12}\n<!--brief-->\n- **Pro:** cheap');
  eq('text stops at the sentinel', split.text, 'Fast. {cost:$12}');
  eq('brief is everything after', split.brief, '- **Pro:** cheap');

  const leading = splitBrief('<!--brief-->\nall brief');
  eq('leading sentinel leaves empty text', leading.text, '');
  eq('leading sentinel keeps the brief', leading.brief, 'all brief');

  const twice = splitBrief('a<!--brief-->b<!--brief-->c');
  eq('first sentinel wins', twice.text, 'a');
  eq('later sentinels stay in the brief', twice.brief, 'b<!--brief-->c');

  eq('undefined is safe', splitBrief(undefined).text, '');
  eq('empty body is no brief', splitBrief('x<!--brief-->   ').brief, '');

  // The ordering the design turns on: a brief ending in a brace pair must not
  // be eaten by METRIC_TAG, which anchors on {...} at end of string.
  const ordered = stripTags([{
    question: 'Which?',
    options: [{ label: 'A', description: 'Fast. {cost:$12}\n<!--brief-->\nuse `{ retries: 3 }`' }],
  }]);
  eq('metrics survive a brace-ending brief',
    ordered.questions[0].options[0].description, 'Fast.');
  eq('brief presence reported', ordered.hasBrief, true);
  eq('metrics presence reported', ordered.hasMetrics, true);

  const qBrief = stripTags([{
    question: 'Which?\n<!--brief-->\ncontext here',
    options: [{ label: 'A', description: 'Plain.' }],
  }]);
  eq('question text stripped', qBrief.questions[0].question, 'Which?');
  eq('question brief counts', qBrief.hasBrief, true);
  eq('no tag means no metrics', qBrief.hasMetrics, false);

  const plain = stripTags([{
    question: 'Which?',
    options: [{ label: 'A', description: 'Plain.' }],
  }]);
  eq('absent brief reported false', plain.hasBrief, false);

  const keys = stripTags([{
    question: 'Which?', header: 'H', multiSelect: true,
    options: [{ label: 'A', description: 'Plain. {cost:$1}' }],
  }]);
  eq('no key added to the question',
    Object.keys(keys.questions[0]).sort((a, b) => a.localeCompare(b)).join(','),
    'header,multiSelect,options,question');
  eq('no key added to the option',
    Object.keys(keys.questions[0].options[0]).sort((a, b) => a.localeCompare(b)).join(','),
    'description,label');
}

console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
process.exit(fail);
