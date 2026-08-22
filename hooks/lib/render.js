'use strict';

// Sole owner of the comparison page. The hook serves what renderPage returns
// over loopback and interprets the POST that comes back.

const { esc } = require('./esc.js');
const { parseMetrics, splitBrief, scalesFor, barPercent } = require('./metrics.js');
const { pickForm, renderChart } = require('./charts.js');
const { renderMd } = require('./md.js');
const { pageScript } = require('./page-script.js');

const STYLES = `
  /* --ok is the accent, not a green: selection means chosen, not successful,
     and a green tick beside the green --s3 series read as a status light. */
  :root { color-scheme: light dark; --ease:cubic-bezier(.2,.7,.3,1);
          --fast:.12s; --mid:.22s; --fg:#1f1e1c; --mut:#6b6a63; --line:#e5e3d9;
          --accent:#c96442; --card:#faf9f5; --bg:#f2f0e9; --ok:#c96442;
          --s0:#2a78d6; --s1:#eda100; --s2:#e87ba4; --s3:#008300; }
  @media (prefers-color-scheme: dark) {
    /* --s3 intentionally repeats the light value: that green clears both
       surfaces, so the repeat is not a leftover. */
    :root { --fg:#f5f4ef; --mut:#a3a19a; --line:#35352f;
            --accent:#e08a68; --card:#262624; --bg:#191917; --ok:#e08a68;
            --s0:#3987e5; --s1:#c98500; --s2:#d55181; --s3:#008300; }
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; padding:2.5rem 1.5rem 7rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif; }
  main { max-width:64rem; margin:0 auto; }
  section + section { margin-top:2.5rem; padding-top:2rem; border-top:1px solid var(--line); }
  /* The serif stops at the question. Cards, charts and briefings stay sans:
     a serif face in chart chrome costs legibility at small sizes. */
  h2 { font-family:ui-serif,Georgia,"Times New Roman",serif; font-weight:600;
       font-size:1.35rem; margin:0 0 1.25rem; letter-spacing:-.01em; }
  h2 em { color:var(--mut); font-weight:400; font-size:.85rem; font-style:normal; }
  h3 { font-size:.95rem; font-weight:650; margin:0 0 .4rem; }
  .grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(21rem,1fr)); }
  .card { position:relative; display:block; width:100%; text-align:left;
          font:inherit; color:inherit; background:var(--card); border:1px solid var(--line);
          border-left:3px solid transparent; border-radius:9px; padding:1rem 1.1rem;
          transition:transform var(--fast) var(--ease), box-shadow var(--fast),
                     border-color var(--mid), background-color var(--mid); }
  button.card { cursor:pointer; }
  button.card:hover { transform:translateY(-1px); box-shadow:0 3px 12px rgba(31,30,28,.07);
          border-color:color-mix(in srgb, var(--accent) 30%, var(--line)); }
  button.card:active { transform:translateY(0); box-shadow:none; }
  .card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  /* The left border is always 3px and only its color changes, so selecting a
     card moves no text. */
  .card[aria-pressed="true"], .card[aria-checked="true"] { border-color:var(--ok); }
  .card .tick { position:absolute; top:.85rem; right:.95rem; width:1.05rem; height:1.05rem;
                border-radius:50%; border:1.5px solid var(--line);
                transition:background-color var(--mid), border-color var(--mid); }
  button.card:hover .tick { border-color:color-mix(in srgb, var(--ok) 55%, var(--line)); }
  .card[aria-pressed="true"] .tick, .card[aria-checked="true"] .tick {
                background:var(--ok); border-color:var(--ok); }
  .card[aria-pressed="true"] .tick::after, .card[aria-checked="true"] .tick::after {
                content:"\\2713"; color:#fff; font-size:.7rem;
                position:absolute; inset:0; display:grid; place-items:center;
                animation:pop .18s var(--ease); }
  .card .kbd { position:absolute; top:.8rem; right:2.4rem; width:1.15rem; height:1.15rem;
                display:grid; place-items:center; border:1px solid var(--line);
                border-radius:4px; color:var(--mut); font-size:.7rem;
                font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                transition:color var(--mid), border-color var(--mid); }
  button.card:hover .kbd { color:var(--fg);
                border-color:color-mix(in srgb, var(--accent) 40%, var(--line)); }
  .rec { margin-left:.45rem; padding:.05rem .4rem; border-radius:4px; font-size:.68rem;
         font-weight:650; letter-spacing:.03em; text-transform:uppercase;
         color:var(--accent); background:color-mix(in srgb, var(--accent) 12%, transparent);
         vertical-align:.08em; }
  .card p { margin:0 0 .85rem; color:var(--mut); font-size:.875rem; }
  .none { font-style:italic; opacity:.65; margin:0; }
  .metric { display:grid; grid-template-columns:minmax(4rem,auto) 1fr minmax(2.5rem,auto);
            align-items:center; gap:.6rem; margin-top:.45rem; font-size:.8rem; }
  .k { color:var(--mut); text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .track { height:7px; background:color-mix(in srgb, var(--accent) 14%, transparent);
           border-radius:4px; overflow:hidden; }
  .track i { display:block; height:100%; background:var(--c,var(--accent)); border-radius:4px; }
  .v { font-variant-numeric:tabular-nums; font-weight:600; }
  footer { position:fixed; inset:auto 0 0 0; padding:.9rem 1.5rem;
           background:color-mix(in srgb,var(--card) 82%,transparent);
           backdrop-filter:blur(8px);
           border-top:1px solid var(--line); display:flex; align-items:center; gap:1rem; }
  #send { font:inherit; font-weight:600; padding:.5rem 1.4rem; border-radius:7px;
          border:0; background:var(--accent); color:#fff; cursor:pointer;
          transition:background-color var(--mid), transform var(--fast) var(--ease),
                     box-shadow var(--fast), opacity var(--mid); }
  #send:hover:not([disabled]) { background:color-mix(in srgb, var(--accent) 88%, #000);
          transform:translateY(-1px); box-shadow:0 3px 10px rgba(31,30,28,.12); }
  #send:active:not([disabled]) { transform:translateY(0); box-shadow:none; }
  #send[disabled] { opacity:.45; cursor:not-allowed; }
  #status { color:var(--mut); font-size:.85rem; transition:color var(--mid); }
  #jump { font:inherit; font-size:.85rem; padding:0; border:0; background:transparent;
          color:var(--mut); cursor:pointer; text-decoration-color:transparent;
          transition:color var(--mid), text-decoration-color var(--mid); }
  #jump:hover { color:var(--fg); text-decoration:underline;
          text-decoration-color:currentColor; }
  .chart { background:var(--card); border:1px solid var(--line); border-radius:9px;
           padding:1rem 1.1rem; margin:0 0 1rem; overflow-x:auto; }
  .chart h4 { margin:0 0 .35rem; font-size:.8rem; font-weight:650; color:var(--mut); }
  .gblock + .gblock { margin-top:.9rem; }
  /* One custom property per option slot; every series-colored mark below
     reads var(--c), so a fifth form adds no color rules. */
  .s0 { --c:var(--s0); } .s1 { --c:var(--s1); }
  .s2 { --c:var(--s2); } .s3 { --c:var(--s3); }
  table.matrix { width:100%; border-collapse:collapse; font-size:.82rem; }
  table.matrix th, table.matrix td { text-align:left; padding:.4rem .55rem; }
  table.matrix thead th { color:var(--mut); font-weight:650; }
  table.matrix tbody tr + tr th, table.matrix tbody tr + tr td {
    border-top:1px solid var(--line); }
  table.matrix th[scope="row"] { font-weight:650; white-space:nowrap; }
  table.matrix td { position:relative; font-variant-numeric:tabular-nums; }
  table.matrix tbody tr { transition:background-color var(--mid); }
  table.matrix tbody tr:hover { background:color-mix(in srgb, var(--fg) 4%, transparent); }
  .fill { position:absolute; left:0; top:.25rem; bottom:.25rem; border-radius:3px;
          opacity:.22; background:var(--c); transform-origin:left;
          animation:grow .45s var(--ease) .1s backwards;
          transition:opacity var(--mid); }
  table.matrix tbody tr:hover .fill { opacity:.34; }
  .cv { position:relative; }
  .chart svg { display:block; width:100%; height:auto; max-height:22rem; }
  .axis { stroke:var(--line); stroke-width:1.5; }
  .alabel { fill:var(--mut); font-size:12px; }
  .plabel { fill:var(--fg); font-size:12px; font-weight:600; }
  /* Radar vertex values. Text wears a text token, never the series color:
     identity comes from the mark beside it, magnitude from the number. */
  .vlabel { fill:var(--fg); font-size:10px; font-variant-numeric:tabular-nums; }
  /* transform-box keeps the scale about the mark's own centre, so a hovered
     point grows in place rather than sliding toward the origin. */
  circle { fill:var(--c); transform-box:fill-box; transform-origin:center;
           transition:transform var(--mid) var(--ease); }
  circle:hover { transform:scale(1.45); }
  .poly { fill:var(--c); stroke:var(--c); fill-opacity:.16; stroke-width:2;
          transition:fill-opacity var(--mid); }
  .poly:hover { fill-opacity:.32; }
  .legend { display:flex; flex-wrap:wrap; gap:.35rem 1rem; margin-top:.6rem;
            font-size:.78rem; color:var(--mut); }
  .lg { display:inline-flex; align-items:center; gap:.35rem; }
  .lg i { width:.7rem; height:.7rem; border-radius:2px; display:inline-block;
          background:var(--c); }
  .card.other { cursor:text; }
  .card.other input { width:100%; font:inherit; font-size:.875rem; color:inherit;
        background:transparent; border:0; border-bottom:1px solid var(--line);
        padding:.3rem 0; }
  .card.other input { transition:border-color var(--mid); }
  .card.other input:focus { outline:0; border-bottom-color:var(--accent); }
  .card.other:focus-within { border-color:var(--accent); }
  .notefield { display:block; margin-top:.9rem; font-size:.8rem; color:var(--mut); }
  .notefield textarea { display:block; width:100%; margin-top:.3rem; min-height:3.2rem;
        font:inherit; font-size:.85rem; color:var(--fg); background:var(--card);
        border:1px solid var(--line); border-radius:7px; padding:.5rem .65rem; resize:vertical;
        transition:border-color var(--mid), box-shadow var(--mid); }
  .notefield textarea:focus { outline:0; border-color:var(--accent);
        box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
  #cancel { margin-left:auto; font:inherit; padding:.5rem 1rem; border-radius:7px; cursor:pointer;
            border:1px solid var(--line); background:transparent; color:var(--mut);
            transition:color var(--mid), border-color var(--mid), background-color var(--mid); }
  #cancel:hover { color:var(--fg); border-color:var(--accent);
            background:color-mix(in srgb, var(--accent) 8%, transparent); }
  .brief { background:var(--card); border:1px solid var(--line); border-radius:9px;
           padding:1rem 1.15rem; margin:0 0 1.25rem; }
  .card-brief { background:transparent; border:0; border-top:1px solid var(--line);
           border-radius:0; padding:.75rem 0 0; margin:.85rem 0 0; }
  .brief > :first-child { margin-top:0; }
  .brief > :last-child { margin-bottom:0; }
  .md-p { margin:0 0 .7rem; font-size:.875rem; }
  /* The question briefing opens with the TL;DR, so it carries more weight
     than the detail under it. Cards are summaries already. */
  section > .brief > .md-p:first-child { font-size:1.02rem; line-height:1.5;
           color:var(--fg); margin-bottom:.9rem; }
  .brief h4 { margin:1rem 0 .4rem; font-size:.8rem; font-weight:650;
           color:var(--mut); text-transform:uppercase; letter-spacing:.04em; }
  .md-list { margin:0 0 .7rem; padding-left:1.1rem; font-size:.85rem; }
  .md-list li { margin:.15rem 0; }
  .card .md-list { color:var(--mut); }
  .md-pre { margin:0 0 .8rem; padding:.7rem .85rem; overflow-x:auto; font-size:.8rem;
           background:color-mix(in srgb, var(--fg) 5%, transparent); border-radius:7px; }
  .brief code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.92em; }
  .md-table { width:100%; border-collapse:collapse; font-size:.82rem; margin:0 0 .8rem; }
  .md-table th, .md-table td { text-align:left; padding:.35rem .55rem;
           border-bottom:1px solid var(--line); }
  .md-table th { color:var(--mut); font-weight:650; }
  .md-table td { font-variant-numeric:tabular-nums; }
  .md-table tbody tr { transition:background-color var(--mid); }
  .md-table tbody tr:hover { background:color-mix(in srgb, var(--fg) 4%, transparent); }
  /* Entrance motion is CSS only. animation-fill-mode backwards holds the
     from-state through the delay, so a staggered card never flashes first. */
  @keyframes rise { from { opacity:0; transform:translateY(6px); } }
  @keyframes grow { from { transform:scaleX(0); } }
  @keyframes pop { from { opacity:0; transform:scale(.4); } }
  .card, .chart, .brief { animation:rise .28s var(--ease) backwards; }
  /* Only the closing screen carries these ids, so the fade costs no markup. */
  #head, #bye { animation:rise .3s var(--ease) backwards; }
  #bye { animation-delay:.06s }
  .grid > :nth-child(2) { animation-delay:.04s }
  .grid > :nth-child(3) { animation-delay:.08s }
  .grid > :nth-child(4) { animation-delay:.12s }
  .grid > :nth-child(5) { animation-delay:.16s }
  /* The fill keeps its inline width; scaleX from the left edge is the growth. */
  .track i { transform-origin:left;
             animation:grow .45s var(--ease) .1s backwards; }
  @media (prefers-reduced-motion:reduce) {
    html { scroll-behavior:auto; }
    *, *::before, *::after { animation:none !important; transition:none !important; }
  }
`;

// One option prepared for rendering: its label, its description with the
// metric tag and briefing removed, its parsed metrics, and its briefing source.
function prepareOptions(q) {
  return (q.options || []).map((o) => {
    const { text, brief } = splitBrief(o.description);
    return { label: o.label ?? '', brief, ...parseMetrics(text) };
  });
}

function barRows(o, scale) {
  return o.metrics
    .map((m) => {
      const pct = barPercent(m, scale);
      return `<div class="metric"><span class="k">${esc(m.key)}</span>
            <span class="track">${pct ? `<i style="width:${pct.toFixed(1)}%"></i>` : ''}</span>
            <span class="v">${esc(m.raw)}</span></div>`;
    })
    .join('');
}

function briefBlock(src, extra = '') {
  const html = src ? renderMd(src) : '';
  return html ? `<div class="brief${extra}">${html}</div>` : '';
}

// `oi` is the option's 0-based index in its question. The digit badge stops at
// the fourth card because AskUserQuestion caps a question at four options.
// AskUserQuestion's own convention for a recommended option is the words
// appended to the label. The badge replaces them in the heading; `data-label`
// keeps the label verbatim, because askq.js filters what the page posts
// against the labels the tool supplied.
const RECOMMENDED = /\s*\(recommended\)\s*$/i;

function card(o, { qi, oi, multi, body }) {
  const hint = oi < 4 ? `<span class="kbd" aria-hidden="true">${oi + 1}</span>` : '';
  // A single-select question is a radio group; only multiSelect is a toggle.
  const state = multi ? 'aria-pressed="false"' : 'role="radio" aria-checked="false"';
  return `<button type="button" class="card" ${state} data-q="${qi}" data-label="${esc(o.label)}">
        ${hint}<span class="tick" aria-hidden="true"></span>
        <h3>${esc(o.label.replace(RECOMMENDED, ''))}${
          RECOMMENDED.test(o.label) ? '<span class="rec">Recommended</span>' : ''}</h3>
        ${o.clean ? `<p>${esc(o.clean)}</p>` : ''}
        ${body}
        ${briefBlock(o.brief, ' card-brief')}</button>`;
}

function renderQuestion(q, qi) {
  const options = prepareOptions(q);
  const { text: qText, brief: qBrief } = splitBrief(q.question);
  const scale = scalesFor(options.map((o) => o.metrics));
  const multi = q.multiSelect === true;
  const requested = options.map((o) => o.chart).find(Boolean) || 'bars';

  // pickForm guards the data shape, but a renderer can still throw on an edge
  // the shape check misses. Losing the whole page over one exotic chart is
  // worse than one question falling back to bars.
  let form = 'bars';
  let chart = '';
  try {
    const picked = pickForm(requested, options);
    chart = renderChart(picked.name, options, scale, picked.shape);
    form = picked.name;
  } catch {
    form = 'bars';
    chart = '';
  }

  // A card with a briefing says enough without also reporting what it lacks.
  const emptyBody = (o) => (o.brief ? '' : '<p class="none">no metrics supplied</p>');
  const bodyFor = (o) => (form === 'bars' ? barRows(o, scale) || emptyBody(o) : '');
  const cards = options
    .map((o, oi) => card(o, { qi, oi, multi, body: bodyFor(o) }))
    .join('');

  // "Something else" is a text field, not a radio. It shares the grid with the
  // option cards, so it takes role="presentation" rather than the grid gaining
  // a wrapper — a radiogroup admits no other kind of child.
  const extras = `
    <label class="card other" role="presentation">
      <h3>Something else</h3>
      <input type="text" data-q="${qi}" maxlength="2000"
             placeholder="Type your own answer…">
    </label>`;

  const notes = `
    <label class="notefield"><span>Notes (optional)</span>
      <textarea class="notes" data-q="${qi}" maxlength="2000"
                placeholder="Anything the answer alone won't carry…"></textarea>
    </label>`;

  return `<section data-q="${qi}" data-multi="${multi}">
    <h2>${esc(qText)}${multi ? ' <em>(pick any)</em>' : ''}</h2>
    ${briefBlock(qBrief)}
    ${chart}
    <div class="grid"${multi ? '' : ' role="radiogroup"'}>${cards}${extras}</div>${notes}
  </section>`;
}

const FOOTER = `<footer><span id="status">Pick an option.</span>
<button id="jump" type="button" hidden></button>
<button id="cancel" type="button">Answer in terminal</button>
<button id="send" disabled>Send answer</button></footer>`;


function renderPage(questions, { nonce = '', waitMs = 0 } = {}) {
  const body = questions.map((q, qi) => renderQuestion(q, qi)).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Answer the question</title>
<style>${STYLES}</style></head><body><main>${body}</main>
${FOOTER}${pageScript(nonce, questions.length, waitMs)}
</body></html>`;
}

module.exports = { renderPage, prepareOptions };
