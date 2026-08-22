'use strict';

// The comparison forms. A form is requested by the model through the reserved
// `chart` key and honoured only when the question's data can carry it;
// otherwise it degrades along the chain below. Drawing a broken axis reads as
// a bug in the data rather than in the request, so degradation is silent.

const { esc } = require('./esc.js');
const { barPercent } = require('./metrics.js');

// One color per option slot. AskUserQuestion caps a question at four options,
// so the modulo is a backstop rather than a real cycle. `bars` never uses them.
const SERIES = 4;
const seriesClass = (i) => `s${i % SERIES}`;

// Each entry is registered whole: `fits`, its `fallback`, and its `render`
// (absent for `bars`, which draws inside the option cards instead of a
// chart block). One object per form, so a sixth form is one literal, not a
// second map kept in sync by hand.
const FORMS = {
  bars:    { fits: () => true },
  grouped: { fits: (s) => s.metrics >= 1, fallback: 'bars', render: grouped },
  matrix:  { fits: (s) => s.metrics >= 1, fallback: 'bars', render: matrix },
  // Scatter plots two fixed axes; an option missing either one would draw as
  // a dropped point (and, since non-bars forms hide the card metric rows,
  // its value would appear nowhere). Requiring both axes on every option
  // turns that into an ordinary degradation instead of losing data silently.
  // Radar shares scatter's requirement for the same reason: an axis an option
  // has no value for would plot at the centre, which reads as a genuine
  // minimum rather than a gap. Degrading to matrix shows the gap as an em dash.
  scatter: { fits: (s) => s.completeNumeric.length >= 2, fallback: 'grouped', render: scatter },
  radar:   { fits: (s) => s.completeNumeric.length >= 3, fallback: 'matrix', render: radar },
};

// Metric keys in declaration order, and which of them can hold an axis.
// Ordinals have a finite rank, so they count as numeric.
function shapeOf(options) {
  const keys = [];
  const numericKeys = [];
  for (const o of options) {
    for (const m of o.metrics) {
      if (!keys.includes(m.key)) keys.push(m.key);
      if (Number.isFinite(m.value) && !numericKeys.includes(m.key)) numericKeys.push(m.key);
    }
  }
  // Numeric keys *every* option carries. An axis-per-key form has no honest
  // way to draw an option that lacks one, so this is the only key set they use.
  const completeNumeric = numericKeys.filter((k) =>
    options.every((o) => o.metrics.some((m) => m.key === k && Number.isFinite(m.value))));
  return { keys, completeNumeric, metrics: keys.length };
}

function pickForm(requested, options) {
  const shape = shapeOf(options);
  const req = String(requested || '').toLowerCase();
  let name = Object.hasOwn(FORMS, req) ? req : 'bars';
  // Chains are two deep and end at `bars`; the bound only guards a
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

// Chart canvas, in user units. The page scales it with viewBox.
const W = 640, H = 360, PAD = 48;

// A non-finite number in an SVG attribute blanks the shape silently rather
// than erroring, so every coordinate is clamped before it reaches the string.
// NaN (and anything that doesn't parse to a number) has no direction to
// clamp toward, so it floors; ±Infinity clamps through Math.min/max like any
// other out-of-range value, landing on hi or lo respectively.
function num(n, lo, hi) {
  const v = Number(n);
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
}

// Axes plot magnitude, not goodness: whether a large cost should sit far right
// is unknowable unless the model declares polarity.
function scatter(options, scale, shape) {
  const [kx, ky] = shape.completeNumeric;
  const points = options
    .map((o, i) => {
      const mx = valueOf(o, kx);
      const my = valueOf(o, ky);
      if (!mx || !my) return '';
      const x = num(PAD + (barPercent(mx, scale) / 100) * (W - PAD * 2), PAD, W - PAD);
      const y = num(H - PAD - (barPercent(my, scale) / 100) * (H - PAD * 2), PAD, H - PAD);
      return `<circle class="${seriesClass(i)}" cx="${x}" cy="${y}" r="6"/>
        <text class="plabel" x="${num(x + 10, PAD, W)}" y="${num(y - 8, 12, H)}">${esc(o.label)}</text>`;
    })
    .join('');

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(kx)} plotted against ${esc(ky)}">
    <line class="axis" x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}"/>
    <line class="axis" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}"/>
    <text class="alabel" x="${W / 2}" y="${H - 12}" text-anchor="middle">${esc(kx)}</text>
    <text class="alabel" x="14" y="${H / 2}" text-anchor="middle"
          transform="rotate(-90 14 ${H / 2})">${esc(ky)}</text>
    ${points}</svg></div>`;
}

// Radar plots magnitude, not goodness — the same normalization the bars use.
// Every axis is one every option carries, so no vertex stands for absent data.
function radar(options, scale, shape) {
  const keys = shape.completeNumeric;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - PAD;
  const angleAt = (i) => (Math.PI * 2 * i) / keys.length - Math.PI / 2;
  const at = (i, frac) => {
    const a = angleAt(i);
    return {
      x: num(cx + Math.cos(a) * r * frac, 0, W),
      y: num(cy + Math.sin(a) * r * frac, 0, H),
    };
  };

  const axes = keys
    .map((k, i) => {
      const end = at(i, 1);
      const label = at(i, 1.14);
      return `<line class="axis" x1="${cx}" y1="${cy}" x2="${end.x}" y2="${end.y}"/>
        <text class="alabel" x="${label.x}" y="${label.y}" text-anchor="middle">${esc(k)}</text>`;
    })
    .join('');

  const polys = options
    .map((o, i) => {
      const pts = keys
        .map((k, ki) => {
          const m = valueOf(o, k);
          const p = at(ki, m ? barPercent(m, scale) / 100 : 0);
          return `${p.x},${p.y}`;
        })
        .join(' ');
      return `<polygon class="poly ${seriesClass(i)}" points="${pts}"/>`;
    })
    .join('');

  // Every vertex carries its own value, so a series stays readable where its
  // hue does not reach 3:1 against the surface. Vertices on one axis are
  // collinear, so labels would stack whenever two options are close; each
  // series is nudged one line height along the axis's perpendicular, which
  // holds four of them apart whatever the radii.
  const step = (i) => (i - (options.length - 1) / 2) * 12;
  const values = options
    .map((o, i) => keys
      .map((k, ki) => {
        const m = valueOf(o, k);
        if (!m) return '';
        const p = at(ki, barPercent(m, scale) / 100);
        const a = angleAt(ki), d = step(i);
        const x = num(p.x - Math.sin(a) * d + Math.cos(a) * 5, 4, W - 4);
        const y = num(p.y + Math.cos(a) * d + Math.sin(a) * 5 + 3.5, 10, H - 4);
        return `<text class="vlabel" x="${x}" y="${y}" text-anchor="middle">${esc(m.raw)}</text>`;
      })
      .join(''))
    .join('');

  const legend = options
    .map((o, i) => `<span class="lg"><i class="${seriesClass(i)}"></i>${esc(o.label)}</span>`)
    .join('');

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="option profiles across ${keys.length} dimensions">${axes}${polys}${values}</svg>
    <div class="legend">${legend}</div></div>`;
}

// '' for any form with no chart block of its own (`bars` draws inside cards).
function renderChart(name, options, scale, shape) {
  const render = FORMS[name]?.render;
  return render ? render(options, scale, shape) : '';
}

module.exports = { shapeOf, pickForm, renderChart, num };
