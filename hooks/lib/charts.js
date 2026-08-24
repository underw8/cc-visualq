'use strict';

// The comparison forms. A form is requested by the model through the reserved
// `chart` key and honoured only when the question's data can carry it;
// otherwise it degrades along the chain below. Drawing a chart the data cannot
// fill reads as a bug in the data rather than in the request, so degradation
// is silent.

const { esc } = require('./esc.js');
const { barPercent } = require('./metrics.js');

// One color per option slot. AskUserQuestion caps a question at four options,
// so the modulo is a backstop rather than a real cycle. `bars` never uses them.
const SERIES = 4;
const seriesClass = (i) => `s${i % SERIES}`;

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

function grouped(options, scale, shape) {
  const blocks = shape.keys
    .map((key) => {
      const rows = options
        .map((o, i) => {
          const m = valueOf(o, key);
          const pct = m ? barPercent(m, scale) : 0;
          return `<div class="metric"><span class="k">${esc(o.label)}</span>
            <span class="track"><i class="${seriesClass(i)}" style="width:${pct.toFixed(1)}%"></i></span>
            <span class="v">${m ? esc(m.raw) : '—'}</span></div>`;
        })
        .join('');
      return `<div class="gblock"><h4>${esc(key)}</h4>${rows}</div>`;
    })
    .join('');
  return `<div class="chart grouped">${blocks}</div>`;
}

function matrix(options, scale, shape) {
  const head = shape.keys.map((k) => `<th>${esc(k)}</th>`).join('');
  const rows = options
    .map((o, i) => {
      const cells = shape.keys
        .map((key) => {
          const m = valueOf(o, key);
          const pct = m ? barPercent(m, scale) : 0;
          return `<td><span class="fill ${seriesClass(i)}" style="width:${pct.toFixed(1)}%"></span>
            <span class="cv">${m ? esc(m.raw) : '—'}</span></td>`;
        })
        .join('');
      return `<tr><th scope="row">${esc(o.label)}</th>${cells}</tr>`;
    })
    .join('');
  return `<div class="chart"><table class="matrix">
    <thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// '' for any form with no chart block of its own (`bars` draws inside cards).
function renderChart(name, options, scale, shape) {
  const render = FORMS[name]?.render;
  return render ? render(options, scale, shape) : '';
}

module.exports = { shapeOf, pickForm, renderChart };
