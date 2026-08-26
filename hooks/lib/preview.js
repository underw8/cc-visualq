'use strict';

// The comparison as an AskUserQuestion option preview, for a host that renders
// one as HTML — the desktop app, when it sets CLAUDE_CODE_QUESTION_PREVIEW_FORMAT
// to `html`. No server, no port, no browser: the fragment travels back as part
// of the tool input and the native dialog draws it.
//
// The tool's own validator sets the shape: an HTML fragment, holding at least
// one tag, with no <script> and no <style>. So every rule here is an inline
// style attribute, and nothing the page's script owns — the scheme toggle, the
// diagram, the countdown, "ask again" — has an equivalent. Colors are
// currentColor and light-dark() pairs, which is what lets the fragment follow
// whatever scheme the host is already in.
//
// One form, always. `chart:` picks between forms on the page because a
// scrolling page can afford to lose values to a shape; a fragment beside an
// option list cannot, so every key states its value the way `matrix` does.

const { esc } = require('./esc.js');
const { splitBrief, scalesFor, winnersFor, rankOf, barPercent } = require('./metrics.js');
const { shapeOf, bandOf, DIR_GLYPH } = require('./charts.js');
const { prepareOptions } = require('./render.js');
const { renderMd } = require('./md.js');

// Ink for a win, and the band ink for an ordinal. The bare hex before each
// light-dark() keeps the light value on an engine without the function.
const ACCENT = 'color:#c96442;color:light-dark(#c96442,#e08a68)';
const BAND = {
  good: 'color:#046b34;color:light-dark(#046b34,#3fbf72)',
  mid: 'color:#8a5a00;color:light-dark(#8a5a00,#e0a33c)',
  bad: 'color:#b3261e;color:light-dark(#b3261e,#f2837a)',
};

const WRAP = 'font:13px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif';
const TABLE = 'width:100%;border-collapse:collapse;margin:0 0 .6rem';
const TH = 'text-align:left;padding:.3rem .5rem;font-size:.85em;font-weight:600;opacity:.65';
// A grey that reads on either surface, so the rule needs no light-dark pair.
const TD = 'padding:.4rem .5rem;vertical-align:top;border-top:1px solid rgba(128,128,128,.3)';

// The rule under a value, in place of a fill behind it: nothing in the preview
// is read through a tint, so a losing value recedes by ink alone.
const rule = (pct, win) => (pct
  ? `<span style="display:block;height:2px;margin-top:.25rem;border-radius:2px;`
    + `background:currentColor;opacity:${win ? '.85' : '.25'};width:${pct.toFixed(1)}%${
      win ? `;${ACCENT}` : ''}"></span>`
  : '');

const pill = (m, dir) => `<span style="display:inline-block;padding:.02rem .4rem;`
  + `border:1px solid currentColor;border-radius:999px;font-size:.9em;${
    BAND[bandOf(m, dir)]}">${esc(m.raw)}</span>`;

// The tick is the load-bearing mark, as on the page: the accent ink beside it
// only reinforces what the glyph already says.
const tick = (win) => (win ? `<span style="${ACCENT}">✓ </span>` : '');

function cell(m, scale, winners, key) {
  if (!m) return `<td style="${TD};opacity:.5">—</td>`;
  const win = rankOf(m, winners);
  const dir = winners?.dir.get(key);
  if (m.kind === 'ordinal') {
    return `<td style="${TD}">${tick(win)}${pill(m, dir)}</td>`;
  }
  const dim = win === false ? ';opacity:.45' : '';
  return `<td style="${TD}${dim}">${tick(win)}${esc(m.raw)}${
    rule(barPercent(m, scale), win === true)}</td>`;
}

// Every option keeps its row and the reader's own option is marked, so the
// comparison stays put while they move down the list.
function table(options, keys, scale, winners, current) {
  const head = keys
    .map((k) => {
      const g = DIR_GLYPH[winners?.dir.get(k)];
      return `<th style="${TH}">${esc(k)}${g ? ` ${g}` : ''}</th>`;
    })
    .join('');
  const rows = options
    .map((o, oi) => {
      const here = oi === current;
      const label = `<th scope="row" style="${TD};font-weight:${here ? 700 : 400}">${
        esc(o.label)}</th>`;
      const cells = keys
        .map((k) => cell(o.metrics.find((m) => m.key === k), scale, winners, k))
        .join('');
      return `<tr${here ? ' style="background:rgba(128,128,128,.12)"' : ''}>${label}${cells}</tr>`;
    })
    .join('');
  return `<table style="${TABLE}"><thead><tr><td></td>${head}</tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}

// The page's order, so the two surfaces read the same way round: what is being
// decided, the comparison, then what this one option costs.
function fragment(options, oi, { keys, scale, winners, qBrief }) {
  const body = [
    renderMd(qBrief),
    keys.length ? table(options, keys, scale, winners, oi) : '',
    renderMd(options[oi]?.brief),
  ].filter(Boolean).join('');
  return body ? `<div style="${WRAP}">${body}</div>` : '';
}

// `clean` is what the tool receives — tags stripped, briefings gone — and `raw`
// is what the model wrote, which is where the metrics and briefings still are.
// A question the host will not draw a preview for is passed through untouched:
// the tool renders previews on single-select questions only.
function withPreviews(clean, raw) {
  return clean.map((q, qi) => {
    if (q.multiSelect === true) return q;
    const options = prepareOptions(raw[qi] || q);
    const metrics = options.map((o) => o.metrics);
    const scale = scalesFor(metrics);
    // After scalesFor, which normalizes the values this compares.
    const winners = winnersFor(metrics);
    const shape = {
      keys: shapeOf(options).keys,
      scale,
      winners,
      qBrief: splitBrief((raw[qi] || q).question).brief,
    };
    const drawn = (q.options || []).map((o, oi) => {
      const html = fragment(options, oi, shape);
      return html ? { ...o, preview: html } : o;
    });
    return { ...q, options: drawn };
  });
}

module.exports = { withPreviews };
