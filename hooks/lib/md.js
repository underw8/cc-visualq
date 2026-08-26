'use strict';

// The briefing subset: paragraphs, one level of lists, pipe tables, fenced
// code, a mermaid diagram, and inline emphasis. Only tags chosen here reach the DOM — esc() runs
// before inline replacement, so a model-written <b> arrives as &lt;b&gt; and
// the second pass cannot revive it. Reversing that order would pass an
// authored tag through intact.
//
// Links are absent deliberately: a href would need scheme validation against
// javascript:, and a page that can navigate away while the hook waits
// for an answer is worse than a briefing without hyperlinks.

const { esc } = require('./esc.js');

const BULLET = /^\s*([-*+]|\d+\.)\s+/;
const PLUS = /^\s*\+\s+/;
const FENCE = /^\s*```/;
const HEADING = /^(#{1,4})\s+(.*)$/;

function inline(s) {
  // Split keeps the code spans as odd-indexed parts, so the emphasis passes
  // only ever run on text outside them: `**/*.js` stays literal.
  return esc(s)
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2
      ? `<code>${part.slice(1, -1)}</code>`
      : part
        .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replaceAll(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')))
    .join('');
}

const cells = (line, tag) =>
  '<tr>' + line.trim().replaceAll(/^\||\|$/g, '').split('|')
    .map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join('') + '</tr>';

// A table needs a separator row bearing its own pipe, not just a dashes-only
// line: without that, prose like "a | b" above a "---" misparses as a table.
// One quantified character class (not two straddling a required literal)
// keeps a long non-matching run linear instead of backtracking quadratically.
const isSeparator = (s) => /^[\s|:-]+$/.test(s) && s.includes('|') && s.includes('-');
const isTable = (lines, i) =>
  (lines[i] || '').includes('|') && isSeparator(lines[i + 1] || '');

// One reader per block type. Each takes the lines and the cursor, and returns
// the markup plus the next cursor, or null when it does not apply. Every reader
// that matches must advance the cursor, or the scan would not terminate.

// A mermaid block is escaped like every other fence. The page reads it with
// textContent, which decodes the entities back to the authored source, so
// mermaid sees `-->` while the markup only ever held `--&gt;`. Nothing here
// relaxes the rule that only tags chosen in this file reach the DOM.
function readFence(lines, i) {
  if (!FENCE.test(lines[i])) return null;
  const lang = lines[i].replace(FENCE, '').trim().toLowerCase();
  const body = [];
  let j = i + 1;
  for (; j < lines.length && !FENCE.test(lines[j]); j++) body.push(lines[j]);
  // j is the closer, or the end of input when the fence was never closed.
  const code = esc(body.join('\n'));
  // A `pre`, which is mermaid's own container: until the bundle claims the
  // block it is source, and only `pre` holds the newlines without a stylesheet
  // behind it — which is the state a briefing is in wherever it travels
  // outside the page.
  const html = lang === 'mermaid'
    ? `<pre class="mermaid">${code}</pre>`
    : `<pre class="md-pre"><code>${code}</code></pre>`;
  return { html, next: j + 1 };
}

function readTable(lines, i) {
  if (!isTable(lines, i)) return null;
  const head = cells(lines[i], 'th');
  const rows = [];
  let j = i + 2;
  for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) {
    rows.push(cells(lines[j], 'td'));
  }
  return {
    html: `<table class="md-table"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table>`,
    next: j,
  };
}

function readHeading(lines, i) {
  const h = HEADING.exec(lines[i]);
  return h ? { html: `<h4>${inline(h[2])}</h4>`, next: i + 1 } : null;
}

// `-` is the ordinary bullet, so a run of them stays an ordinary list — styling
// every `-` as a drawback would turn every briefing list into a list of
// drawbacks. One `+` anywhere in the run is what declares it a trade-off list,
// and only then does each `-` beside it read as a con. The whole run is
// collected before that call, since the last line can be what decides it.
function readList(lines, i) {
  if (!BULLET.test(lines[i])) return null;
  const tag = /^\s*\d/.test(lines[i]) ? 'ol' : 'ul';
  const run = [];
  let j = i;
  for (; j < lines.length && BULLET.test(lines[j]); j++) run.push(lines[j]);
  const procon = tag === 'ul' && run.some((l) => PLUS.test(l));
  const items = run.map((l) => {
    const kind = procon ? (PLUS.test(l) ? 'pro' : 'con') : '';
    // The glyph is markup, not a CSS `content`, because a briefing also travels
    // to a host that renders it with no stylesheet of ours: valence has to
    // survive there, and the glyph is what carries it. U+2212 for the con, not a
    // hyphen: it matches the plus in width, keeping a mixed run on one left
    // edge. The trailing space is for that same stylesheet-less surface, where
    // the two would otherwise be flush; a grid item drops its leading white
    // space, so the page is unaffected.
    const mark = kind ? `<span class="g">${kind === 'pro' ? '+' : '\u2212'}</span> ` : '';
    return `<li${kind ? ` class="${kind}"` : ''}>${mark}${inline(l.replace(BULLET, ''))}</li>`;
  });
  return {
    html: `<${tag} class="md-list${procon ? ' procon' : ''}">${items.join('')}</${tag}>`,
    next: j,
  };
}

// Last, and the only reader that always matches: anything no other reader
// claimed is prose, running until a line another reader would claim.
function readParagraph(lines, i) {
  const para = [];
  let j = i;
  for (; j < lines.length && lines[j].trim() && !BULLET.test(lines[j])
         && !FENCE.test(lines[j]) && !HEADING.test(lines[j]) && !isTable(lines, j); j++) {
    para.push(lines[j]);
  }
  return { html: `<p class="md-p">${inline(para.join(' '))}</p>`, next: j };
}

const READERS = [readFence, readTable, readHeading, readList, readParagraph];

function renderMd(src) {
  const lines = String(src ?? '').replaceAll('\r', '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    for (const read of READERS) {
      const block = read(lines, i);
      if (!block) continue;
      if (block.html) out.push(block.html);
      // Progress is guaranteed rather than trusted: a reader that returned the
      // cursor it was given would spin, and this runs inside a blocking hook.
      i = Math.max(block.next, i + 1);
      break;
    }
  }
  return out.join('');
}

module.exports = { renderMd };
