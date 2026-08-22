'use strict';

// Parses the `{key:value, ...}` tag Claude appends to an option's description
// and normalizes each value to a comparable number.
//
// Raw parseFloat is wrong here: it reads "4mb" as 4 and "12kb" as 12, so the
// larger size draws the shorter bar. Values are scaled to a canonical unit per
// dimension (bytes, milliseconds, ...) and only compared against values of the
// same dimension.

const METRIC_TAG = /\{([^{}]*:[^{}]*)\}\s*$/;

// Multipliers to a canonical unit. Binary sizes use 1024; SI counts use 1000.
// Only the units the session rule advertises; anything else ranks as a bare
// number, which still orders correctly within its key.
const UNITS = {
  bytes: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 },
  ms:    { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 },
  count: { k: 1e3, m: 1e6, b: 1e9 },
  pct:   { '%': 1 },
};

// "m" is minutes in a duration and millions in a count; "b" is bytes or
// billions. Ambiguity is resolved by the other units present under the same
// metric key, so a key is classified once for all its options.
const AMBIGUOUS = new Set(['m', 'b']);

const ORDINALS = ['none', 'minimal', 'low', 'medium', 'high', 'critical'];
const ORDINAL_MAX = ORDINALS.length - 1;

// Leading currency/sign, digits with optional separators, then a unit suffix.
const NUMERIC = /^([+-]?)\s*[$€£¥]?\s*(\d[\d,_]*(?:\.\d+)?)\s*([a-z%µ]*)$/i;

// Returns { value, dimension } or null when the text is not numeric.
// `value` is in the dimension's canonical unit; dimension is null when unitless.
function parseNumeric(raw) {
  const m = NUMERIC.exec(String(raw).trim());
  if (!m) return null;
  const [, sign, digits, rawUnit] = m;
  const n = Number.parseFloat(digits.replaceAll(/[,_]/g, ''));
  if (!Number.isFinite(n)) return null;
  const signed = sign === '-' ? -n : n;
  const unit = rawUnit.toLowerCase().replace('µ', 'u');
  if (!unit) return { value: signed, dimension: null, unit: '' };

  for (const [dimension, table] of Object.entries(UNITS)) {
    // hasOwnProperty, not a bare lookup: `unit` is model-supplied text, and
    // "constructor" would otherwise resolve on the prototype.
    if (Object.hasOwn(table, unit)) {
      return {
        value: signed * table[unit],
        dimension,
        unit,
        ambiguous: AMBIGUOUS.has(unit),
      };
    }
  }
  // Unrecognized suffix ("req", "pts"): still a number, just unitless.
  return { value: signed, dimension: null, unit };
}

function parseOrdinal(raw) {
  const rank = ORDINALS.indexOf(String(raw).trim().toLowerCase());
  return rank === -1 ? null : { rank, max: ORDINAL_MAX };
}

// One metric: { key, raw, value, dimension, ordinal } where value is comparable
// within its dimension, or null when the text carries no magnitude at all.
function parseValue(raw) {
  const num = parseNumeric(raw);
  if (num) return { kind: 'number', ...num };
  const ord = parseOrdinal(raw);
  if (ord) return { kind: 'ordinal', value: ord.rank, max: ord.max, dimension: 'ordinal' };
  return { kind: 'text', value: null, dimension: null };
}

// `chart` names the comparison form rather than a dimension, so it is pulled
// out of the pairs and never drawn as a bar. An option whose genuine metric is
// named `chart` loses it; there is no escape hatch.
const RESERVED = 'chart';

function parseMetrics(description) {
  const m = METRIC_TAG.exec(description || '');
  if (!m) return { clean: (description || '').trim(), metrics: [], chart: '' };

  const metrics = [];
  let chart = '';
  // Split only on commas that begin the next `key:` pair, so a thousands
  // separator inside a value ("$1,200") stays with its value.
  for (const pair of m[1].split(/,(?=\s*[^,:]+\s*:)/)) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const raw = pair.slice(idx + 1).trim();
    if (!key || !raw) continue;
    if (key.toLowerCase() === RESERVED) { chart = chart || raw; continue; }
    metrics.push({ key, raw, ...parseValue(raw) });
  }
  return { clean: description.slice(0, m.index).trim(), metrics, chart };
}

// A briefing is the remainder of a model-authored string after this sentinel.
// It runs to end of string, so a fenced code block inside it cannot terminate
// it early. Splitting it off before parseMetrics is what keeps the metric tag
// last in what remains: a brief ending in "{ retries: 3 }" would otherwise be
// read as the tag and lost.
const BRIEF = '<!--brief-->';

function splitBrief(text) {
  const s = String(text ?? '');
  const i = s.indexOf(BRIEF);
  return i === -1
    ? { text: s, brief: '' }
    : { text: s.slice(0, i).trim(), brief: s.slice(i + BRIEF.length).trim() };
}

// The hook echoes `questions` back with the display-only tag and briefing
// removed, and needs to know whether either was present: a question with
// neither opens no page at all. One pass answers all three.
function stripTags(questions) {
  let hasMetrics = false;
  let hasBrief = false;
  const stripped = questions.map((q) => {
    const qs = splitBrief(q.question);
    if (qs.brief) hasBrief = true;
    return {
      ...q,
      question: qs.text,
      options: (q.options || []).map((o) => {
        const os = splitBrief(o.description);
        if (os.brief) hasBrief = true;
        const { clean, metrics } = parseMetrics(os.text);
        if (metrics.length) hasMetrics = true;
        return { ...o, description: clean };
      }),
    };
  });
  return { questions: stripped, hasMetrics, hasBrief };
}

// A key whose values mix dimensions (one "4mb", one "2s") can't share a scale;
// treat the whole key as unitless so at least the numbers rank consistently.
// Metrics sharing a key, so one key is classified once for all its options.
function groupByKey(optionMetrics) {
  const byKey = new Map();
  for (const m of optionMetrics.flat()) {
    if (!byKey.has(m.key)) byKey.set(m.key, []);
    byKey.get(m.key).push(m);
  }
  return byKey;
}

// The dimension this key is written in, or null when its values disagree and
// no shared scale exists, or undefined when nothing states one.
function firmDimension(group) {
  const firm = new Set(
    group.filter((m) => m.dimension && !m.ambiguous).map((m) => m.dimension));
  if (firm.size > 1) return null;
  return firm.size === 1 ? [...firm][0] : undefined;
}

// "2m" is minutes beside "2h" and millions beside "500k": an ambiguous unit
// takes the dimension its unambiguous siblings are written in.
function adoptDimension(m, only) {
  if (!m.ambiguous || m.dimension === only) return;
  const mult = UNITS[only][m.unit];   // unit is 'm' or 'b' here, never inherited
  const base = Number.parseFloat(String(m.raw).replaceAll(/[^\d.-]/g, ''));
  if (mult && Number.isFinite(base)) { m.value = base * mult; m.dimension = only; }
}

function resolveDimensions(optionMetrics) {
  for (const group of groupByKey(optionMetrics).values()) {
    const only = firmDimension(group);
    // Values in two dimensions under one key cannot share a scale, so the raw
    // numbers rank instead.
    if (only === null) for (const m of group) m.dimension = null;
    else if (only !== undefined) for (const m of group) adoptDimension(m, only);
  }
}

// Per-key maxima, so unrelated units never share a scale.
function scalesFor(optionMetrics) {
  resolveDimensions(optionMetrics);
  const max = new Map();
  for (const m of optionMetrics.flat()) {
    if (m.kind === 'ordinal') {
      max.set(m.key, Math.max(max.get(m.key) ?? 0, m.max));
      continue;
    }
    if (!Number.isFinite(m.value)) continue;
    max.set(m.key, Math.max(max.get(m.key) ?? 0, Math.abs(m.value)));
  }
  return max;
}

// Bar width for one metric, 0 when it has no magnitude to show.
function barPercent(metric, scale) {
  const peak = scale.get(metric.key) ?? 0;
  if (peak <= 0 || !Number.isFinite(metric.value)) return 0;
  return Math.max(2, (Math.abs(metric.value) / peak) * 100);
}

module.exports = { parseMetrics, stripTags, splitBrief, scalesFor, barPercent, parseValue };
