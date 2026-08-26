'use strict';

// The comparison forms. A form is requested by the model through the reserved
// `chart` key and honoured only when the question's data can carry it;
// otherwise it degrades along the chain below. Drawing a chart the data cannot
// fill reads as a bug in the data rather than in the request, so degradation
// is silent.

const { esc } = require('./esc.js');
const { barPercent, rankOf } = require('./metrics.js');

// The ordinal vocabulary is a severity scale, so the word carries its own
// valence whatever key it sits under and `critical` is never good news. Index
// is the rank: none, minimal, low, medium, high, critical.
const BANDS = ['good', 'good', 'good', 'mid', 'bad', 'bad'];

// One metric as its marks: three grid children, always, so a row keeps its
// columns whether or not the option has a value for the key or a winner. An ordinal is a
// state and a place on a scale at once and gets both — the stepped track for
// the place, a pill for the state. The option cards in `render.js` emit through
// here too, so a card row and a chart row cannot drift apart.
function markCell(m, scale, rank = null, dir = '') {
  // The glyph column is emitted whether or not anything won it, so a row keeps
  // its columns on a question where no key declares a direction.
  const tick = `<span class="mark">${rank ? '\u2713' : ''}</span>`;
  if (!m) return `<span class="track"></span><span class="v">\u2014</span>${tick}`;
  const pct = barPercent(m, scale);
  const fill = rank === false ? ' class="dim"' : '';
  const bar = pct ? `<i${fill} style="width:${pct.toFixed(1)}%"></i>` : '';
  // An ordinal's value is its pill, and the pill's ink is its band, so a losing
  // ordinal is not dimmed \u2014 that would spend the band to say what the glyph
  // already says.
  if (m.kind === 'ordinal') {
    return `<span class="track ord">${bar}</span><span class="v">${pill(m, dir)}</span>${tick}`;
  }
  const dim = rank === false ? ' class="v dim"' : ' class="v"';
  return `<span class="track">${bar}</span><span${dim}>${esc(m.raw)}</span>${tick}`;
}

// What the glyph means, stated once per key rather than once per row.
const DIR_NOTE = { lower: 'lower is better', higher: 'higher is better' };
const DIR_GLYPH = { lower: '\u2193', higher: '\u2191' };

// A declared direction outranks the vocabulary's own reading: `ecosystem\u2191: high`
// is good news, so the band is inverted rather than left saying `high` is
// severe. Without an arrow the severity reading stands, since that is all the
// word itself carries.
const bandOf = (m, dir) => BANDS[dir === 'higher' ? m.max - m.value : m.value] || 'mid';

const pill = (m, dir) => `<span class="pill ${bandOf(m, dir)}">${esc(m.raw)}</span>`;

// Each entry is registered whole: `fits`, its `fallback`, and its `render`
// (absent for `bars`, which draws inside the option cards instead of a
// chart block). One object per form, so a fourth form is one literal, not a
// second map kept in sync by hand.
//
// Every form here prints each value as text beside its bar, so a key an option
// has no value for shows as an em dash rather than as a mark at zero. That is
// what an axis-per-key form could not say, and why none is offered.
const FORMS = {
  bars:    { fits: () => true },
  grouped: { fits: (s) => s.metrics >= 1, fallback: 'bars', render: grouped },
  matrix:  { fits: (s) => s.metrics >= 1, fallback: 'bars', render: matrix },
};

// Metric keys in declaration order.
function shapeOf(options) {
  const keys = [];
  for (const o of options) {
    for (const m of o.metrics) if (!keys.includes(m.key)) keys.push(m.key);
  }
  return { keys, metrics: keys.length };
}

function pickForm(requested, options) {
  const shape = shapeOf(options);
  const req = String(requested || '').toLowerCase();
  let name = Object.hasOwn(FORMS, req) ? req : 'bars';
  // Chains are one deep and end at `bars`; the bound only guards a
  // hand-edited FORMS, since no real chain loops.
  for (let i = 0; i < 3 && !FORMS[name].fits(shape); i++) {
    name = FORMS[name].fallback || 'bars';
  }
  return { name, shape };
}

const valueOf = (o, key) => o.metrics.find((m) => m.key === key);

function grouped(options, scale, shape, winners) {
  const blocks = shape.keys
    .map((key) => {
      const rows = options
        .map((o) => {
          const m = valueOf(o, key);
          return `<div class="metric"><span class="k">${esc(o.label)}</span>
            ${markCell(m, scale, rankOf(m, winners), winners?.dir.get(key))}</div>`;
        })
        .join('');
      const note = DIR_NOTE[winners?.dir.get(key)];
      const head = note ? `${esc(key)} <span class="dir">\u00b7 ${note}</span>` : esc(key);
      return `<div class="gblock"><h4>${head}</h4>${rows}</div>`;
    })
    .join('');
  return `<div class="chart grouped">${blocks}</div>`;
}

// The number is the mark and the bar is a rule beneath it, so no value is read
// through a fill.
function matrix(options, scale, shape, winners) {
  const head = shape.keys
    .map((k) => {
      const g = DIR_GLYPH[winners?.dir.get(k)];
      return `<th>${esc(k)}${g ? ` <span class="dir">${g}</span>` : ''}</th>`;
    })
    .join('');
  const rows = options
    .map((o) => {
      const cells = shape.keys
        .map((key) => {
          const m = valueOf(o, key);
          if (!m) return '<td><span class="cv">\u2014</span></td>';
          const rank = rankOf(m, winners);
          const td = rank ? '<td class="win">' : '<td>';
          if (m.kind === 'ordinal') {
            return `${td}<span class="cv">${pill(m, winners?.dir.get(key))}</span></td>`;
          }
          const pct = barPercent(m, scale);
          const dim = rank === false ? ' class="cv dim"' : ' class="cv"';
          const fill = rank === false ? ' class="dim"' : '';
          return `${td}<span${dim}>${esc(m.raw)}</span>
            <span class="u">${pct ? `<b${fill} style="width:${pct.toFixed(1)}%"></b>` : ''}</span></td>`;
        })
        .join('');
      return `<tr><th scope="row">${esc(o.label)}</th>${cells}</tr>`;
    })
    .join('');
  return `<div class="chart"><table class="matrix">
    <thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// '' for any form with no chart block of its own (`bars` draws inside cards).
function renderChart(name, options, scale, shape, winners) {
  const render = FORMS[name]?.render;
  return render ? render(options, scale, shape, winners) : '';
}

module.exports = { shapeOf, pickForm, renderChart, markCell, bandOf, DIR_GLYPH };
