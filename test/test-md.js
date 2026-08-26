#!/usr/bin/env node
// Self-check for hooks/lib/md.js: the briefing subset, and that no
// model-authored tag survives into the output.
'use strict';

const { renderMd } = require('../hooks/lib/md.js');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { console.log('  FAIL ' + m + '\n     ' + d); fail = 1; };
const eq = (m, got, want) =>
  got === want ? ok(m) : bad(m, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const has = (m, hay, needle) =>
  hay.includes(needle) ? ok(m) : bad(m, `missing ${JSON.stringify(needle)} in ${JSON.stringify(hay)}`);
const lacks = (m, hay, needle) =>
  hay.includes(needle) ? bad(m, `unexpected ${JSON.stringify(needle)} in ${JSON.stringify(hay)}`) : ok(m);

console.log('1. block types');
{
  has('paragraph', renderMd('hello there'), '<p class="md-p">hello there</p>');
  has('paragraph joins wrapped lines', renderMd('one\ntwo'), '<p class="md-p">one two</p>');
  has('blank line splits paragraphs', renderMd('one\n\ntwo'),
    '<p class="md-p">one</p><p class="md-p">two</p>');

  const ul = renderMd('- a\n- b');
  has('unordered list', ul, '<ul class="md-list">');
  has('two items', ul, '<li>a</li><li>b</li>');
  has('plus bullets', renderMd('+ a'), '<li class="pro"><span class="g">+</span> a</li>');
  has('star bullets', renderMd('* a'), '<li>a</li>');
  has('ordered list', renderMd('1. a\n2. b'), '<ol class="md-list">');

  has('h1 becomes h4', renderMd('# Title'), '<h4>Title</h4>');
  has('h2 becomes h4', renderMd('## Title'), '<h4>Title</h4>');
  has('h3 becomes h4', renderMd('### Title'), '<h4>Title</h4>');
  has('h4 becomes h4', renderMd('#### Title'), '<h4>Title</h4>');

  const table = renderMd('| a | b |\n|---|---|\n| 1 | 2 |');
  has('table head', table, '<thead><tr><th>a</th><th>b</th></tr></thead>');
  has('table body', table, '<tbody><tr><td>1</td><td>2</td></tr></tbody>');

  has('fenced code', renderMd('```\nx = 1\n```'),
    '<pre class="md-pre"><code>x = 1</code></pre>');

  // A mermaid fence is the one fence that becomes a div rather than a pre, and
  // the only thing that changes is the wrapper: the source is escaped exactly
  // as any other fence, because the page reads it back with textContent.
  const mer = renderMd('```mermaid\nflowchart LR\n  A[x] --> B[y]\n```');
  has('mermaid fence becomes a pre', mer, '<pre class="mermaid">');
  has('mermaid source escaped like any fence', mer, 'A[x] --&gt; B[y]');
  lacks('but not a code block', mer, 'md-pre');
  // A pre, not a div, so the source keeps its newlines wherever a briefing
  // travels with no stylesheet of ours behind it.
  has('the source keeps its newlines', mer, 'flowchart LR\n');
  has('mermaid language is case-insensitive',
    renderMd('```MERMAID\ngraph TD\n```'), '<pre class="mermaid">');
  lacks('another language stays a pre',
    renderMd('```js\nconst a = 1;\n```'), 'class="mermaid"');
  lacks('a bare fence stays a pre',
    renderMd('```\nflowchart LR\n```'), 'class="mermaid"');
  // The wrapper is chosen here, so an authored tag inside one cannot become one.
  lacks('no live tag from a mermaid fence',
    renderMd('```mermaid\n<img src=x onerror=alert(1)>\n```'), '<img');
  has('fence keeps newlines', renderMd('```\na\nb\n```'), '<code>a\nb</code>');
}

console.log('2. inline');
{
  has('strong', renderMd('a **b** c'), '<strong>b</strong>');
  has('em', renderMd('a *b* c'), '<em>b</em>');
  has('code span', renderMd('a `b` c'), '<code>b</code>');
  has('inline inside a list item', renderMd('- **Pro:** cheap'), '<strong>Pro:</strong>');
  has('inline inside a table cell', renderMd('| a |\n|---|\n| **b** |'), '<strong>b</strong>');
  has('inline inside a heading', renderMd('# **T**'), '<h4><strong>T</strong></h4>');

  has('code span holds literal **bold**', renderMd('a `**bold**` b'), '<code>**bold**</code>');
  lacks('code span does not emit strong tag', renderMd('a `**bold**` b'), '<strong>bold</strong>');
  has('code span with glob pattern', renderMd('`**/*.js`'), '<code>**/*.js</code>');
  has('code span literal and emphasis outside', renderMd('`*x*` and **y**'), '<code>*x*</code>');
  has('code span literal and emphasis still renders outside', renderMd('`*x*` and **y**'), '<strong>y</strong>');
  has('two code spans both render', renderMd('a `*b*` c `**d**` e'), '<code>*b*</code>');
  has('second code span also renders', renderMd('a `*b*` c `**d**` e'), '<code>**d**</code>');
  eq('numeric prose unchanged', renderMd('costs 5 dollars and 6 cents'), '<p class="md-p">costs 5 dollars and 6 cents</p>');
}

console.log('3. nothing authored reaches the DOM');
{
  const positions = {
    paragraph: '<script>alert(1)</script>',
    list: '- <script>alert(1)</script>',
    table: '| a |\n|---|\n| <script>alert(1)</script> |',
    heading: '# <script>alert(1)</script>',
    code: '```\n<script>alert(1)</script>\n```',
  };
  for (const [where, src] of Object.entries(positions)) {
    lacks('no live script in a ' + where, renderMd(src), '<script');
    has('script escaped in a ' + where, renderMd(src), '&lt;script&gt;');
  }
  lacks('authored bold tag does not survive', renderMd('<b>x</b>'), '<b>');
  has('authored bold tag is escaped', renderMd('<b>x</b>'), '&lt;b&gt;');
  has('ampersand escaped', renderMd('a & b'), '&amp;');
  lacks('links are not rendered', renderMd('[x](javascript:alert(1))'), '<a ');
  has('link text stays literal', renderMd('[x](https://e.com)'), '[x](https://e.com)');
}

console.log('4. malformed input degrades');
{
  eq('empty string', renderMd(''), '');
  eq('undefined', renderMd(undefined), '');
  eq('null', renderMd(null), '');
  eq('only whitespace', renderMd('\n\n  \n'), '');

  has('unterminated fence still emits a block', renderMd('```\na\nb'), '<code>a\nb</code>');
  const noSep = renderMd('| a | b |\n| 1 | 2 |');
  lacks('table without a separator is not a table', noSep, '<table');
  has('table without a separator is prose', noSep, '<p class="md-p">');

  const big = renderMd(Array.from({ length: 5000 }, (_, i) => 'line ' + i).join('\n'));
  eq('a large input terminates and produces one paragraph',
    (big.match(/<p class="md-p">/g) || []).length, 1);
}

console.log('5. a table separator must carry its own pipe');
{
  const noPipeSep = renderMd('use a | b\n---\nnext');
  lacks('dash-only separator without a pipe is not a table', noPipeSep, '<table');
  has('the dash line stays in the prose', noPipeSep, '---');

  const withPipeSep = renderMd('| a | b |\n|---|---|\n| 1 | 2 |');
  has('separator with a pipe is still a table', withPipeSep, '<table');
}

console.log('6. a long dash run returns promptly instead of backtracking');
{
  const t0 = Date.now();
  renderMd('| h |\n' + '-'.repeat(200_000) + 'x');
  const ms = Date.now() - t0;
  ms < 2000 ? ok(`handled in ${ms}ms`) : bad('long dash run', `took ${ms}ms`);
}

console.log('7. trade-off lists');
{
  const mixed = renderMd('+ fast\n+ small\n- untyped');
  has('the run is marked', mixed, '<ul class="md-list procon">');
  has('a plus is a pro', mixed, '<li class="pro"><span class="g">+</span> fast</li>');
  has('a dash beside it is a con', mixed, '<li class="con"><span class="g">\u2212</span> untyped</li>');
  eq('two pros and one con', (mixed.match(/class="pro"/g) || []).length, 2);

  // `-` is the ordinary bullet marker. Styling every one of them as a drawback
  // would turn every briefing list into a list of drawbacks, so a run with no
  // plus in it stays an ordinary list.
  const plain = renderMd('- one\n- two');
  lacks('a dash-only run is not a trade-off list', plain, 'procon');
  lacks('and its items carry no valence', plain, 'class="con"');

  has('a plus-only run is all pros', renderMd('+ a\n+ b'), 'class="md-list procon"');
  eq('with no cons in it', (renderMd('+ a\n+ b').match(/class="con"/g) || []).length, 0);

  // The deciding plus can be the last line of the run, so the whole run is
  // collected before the call is made.
  has('a trailing plus still marks the run', renderMd('- a\n+ b'), 'procon');
  has('and the earlier dash becomes a con', renderMd('- a\n+ b'),
    '<li class="con"><span class="g">\u2212</span> a</li>');

  lacks('an ordered list is never a trade-off list', renderMd('1. a\n2. b'), 'procon');

  // Two runs split by a blank line are two lists; one being a trade-off list
  // does not make the other one.
  const two = renderMd('+ a\n- b\n\n- c\n- d');
  eq('the first run is marked and the second is not',
    (two.match(/class="md-list procon"/g) || []).length, 1);

  has('item text is still escaped', renderMd('+ <b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  has('inline markup still applies', renderMd('+ **bold**'), '<strong>bold</strong>');
}

console.log('\n' + (fail ? 'FAILURES' : 'PASS'));
process.exit(fail);
