'use strict';

// Sole owner of the comparison page. The hook serves what renderPage returns
// over loopback and interprets the POST that comes back.

const { esc } = require('./esc.js');
const { parseMetrics, splitBrief, scalesFor, winnersFor, rankOf } = require('./metrics.js');
const { pickForm, renderChart, markCell } = require('./charts.js');
const { renderMd } = require('./md.js');
const { pageScript, mermaidScript } = require('./page-script.js');

const STYLES = `
  /* One declaration per token, light value then dark. prefers-color-scheme
     cannot be overridden from CSS, so a scheme the reader picks has to come
     through color-scheme, which light-dark() reads and the toggle sets. The
     bare hex before each light-dark() is the fallback: an engine without the
     function drops the second declaration and keeps the light theme rather
     than losing the token altogether.
     --ok is the accent, not a green: selection means chosen, not successful,
     and a green tick reads as a status light beside the ordinal pill's own.
     --accent is ink at one site and fill at another, and those pull opposite
     ways: #fff over the dark accent measures 2.62:1. --on-accent is the ink for
     a filled accent, read by #send and .tick::after, and any third filled site.
     One value serves both schemes because the accent is mid-tone in each
     (5.05:1 light, 7.50:1 dark); a scheme-flipping accent would need a pair.
     --s3 repeats across schemes because that green clears both surfaces. */
  :root { color-scheme: light dark; --ease:cubic-bezier(.2,.7,.3,1);
          --fast:.12s; --mid:.22s;
          --fg:#1f1e1c; --fg:light-dark(#1f1e1c,#f5f4ef);
          --mut:#6b6a63; --mut:light-dark(#6b6a63,#a3a19a);
          --line:#e5e3d9; --line:light-dark(#e5e3d9,#35352f);
          --accent:#c96442; --accent:light-dark(#c96442,#e08a68);
          --card:#faf9f5; --card:light-dark(#faf9f5,#262624);
          --bg:#f2f0e9; --bg:light-dark(#f2f0e9,#191917);
          --ok:#c96442; --ok:light-dark(#c96442,#e08a68);
          --pro:#046b34; --pro:light-dark(#046b34,#3fbf72);
          --warn:#8a5a00; --warn:light-dark(#8a5a00,#e0a33c);
          --con:#b3261e; --con:light-dark(#b3261e,#f2837a);
          --on-accent:#0b0b0b; }
  /* The toggle writes one property and every token above follows it. */
  :root[data-scheme="light"] { color-scheme: light; }
  :root[data-scheme="dark"] { color-scheme: dark; }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; padding:2.5rem 1.5rem 7rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif; }
  main { max-width:64rem; margin:0 auto; }
  section + section { margin-top:2.5rem; padding-top:2rem; border-top:1px solid var(--line); }
  /* The serif stops at the question. Cards, charts and briefings stay sans: a
     serif face in chart chrome costs legibility at small sizes. At regular
     weight, not bold — the face is the editorial note, and size alone
     carries the hierarchy. Twice the body text, in em off the inherited size
     rather than rem: rem would double the root, not the 15px the page is
     actually set in. */
  h2 { font-family:ui-serif,Georgia,"Times New Roman",serif; font-weight:400;
       font-size:2em; margin:0 0 1.25rem; letter-spacing:-.01em; }
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
                content:"\\2713"; color:var(--on-accent); font-size:.7rem;
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
  .metric { display:grid;
            grid-template-columns:minmax(4rem,auto) 1fr minmax(2.5rem,auto) .9rem;
            align-items:center; gap:.6rem; margin-top:.45rem; font-size:.8rem; }
  /* A card is narrow enough for the track to fill it; a chart block sits in a
     64rem page, where a 1fr track puts the value a viewport away from the bar
     end it belongs to. The cap is what keeps the two adjacent. */
  .chart .metric { grid-template-columns:minmax(5rem,7rem) 20rem auto .9rem;
            justify-content:start; }
  .k { color:var(--mut); text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* The unfilled remainder is neutral, not a wash of the fill's own hue: with
     one accent on every bar, an accent-tinted track separates from the fill by
     alpha alone. */
  .track { height:7px; background:color-mix(in srgb, var(--fg) 8%, transparent);
           border-radius:4px; position:relative; }
  .track i { display:block; height:100%; background:var(--accent);
           border-radius:0 4px 4px 0; }
  /* An ordinal is one of six named steps, so its track is cut into six. The
     gaps are painted over the whole track in the surface color: segmenting the
     fill instead scales the pitch to the fill's own width, and every row then
     reads as a different scale. */
  .track.ord::after { content:''; position:absolute; inset:0;
           background:repeating-linear-gradient(90deg,
             transparent 0 calc(16.666% - 2px), var(--card) calc(16.666% - 2px) 16.666%); }
  /* The word states the ordinal; the track only places it. Ink carries the
     band, so the pill survives a reader who sees no color at all. */
  .pill { display:inline-flex; font-weight:600; font-size:.95em; line-height:1.35;
           padding:0 .45rem; border-radius:999px; border:1px solid currentColor; }
  .pill.good { color:var(--pro); } .pill.mid { color:var(--warn); }
  .pill.bad { color:var(--con); }
  .v { font-variant-numeric:tabular-nums; font-weight:600; }
  /* A declared direction is what earns the glyph and the dimming: without one
     no row wins, so nothing is dimmed and this never fires. Ink weight and the
     glyph carry the win together, so it survives a reader who sees no color \u2014
     which is also why the accent is not the mark. */
  .mark { color:var(--accent); font-weight:700; line-height:1; }
  .v.dim, .cv.dim { color:var(--mut); font-weight:500; }
  /* A losing fill recedes to neutral, so the accent is left meaning "best on
     this key". It stays a lightness step from the accent (1.94:1 light,
     2.26:1 dark) rather than a hue away, so the pair survives greyscale; the
     glyph is what carries the win where neither reads. */
  .track i.dim, .u b.dim { background:color-mix(in srgb, var(--fg) 30%, transparent); }
  h4 .dir, table.matrix .dir { font-weight:400; color:var(--mut); }
  footer { position:fixed; inset:auto 0 0 0; padding:.9rem 1.5rem;
           background:color-mix(in srgb,var(--card) 82%,transparent);
           backdrop-filter:blur(8px);
           border-top:1px solid var(--line); display:flex; align-items:center; gap:1rem; }
  #send { font:inherit; font-weight:600; padding:.5rem 1.4rem; border-radius:7px;
          border:0; background:var(--accent); color:var(--on-accent); cursor:pointer;
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
  table.matrix { width:100%; border-collapse:collapse; font-size:.82rem; }
  table.matrix th, table.matrix td { text-align:left; padding:.4rem .55rem; }
  table.matrix thead th { color:var(--mut); font-weight:650; }
  table.matrix tbody tr + tr th, table.matrix tbody tr + tr td {
    border-top:1px solid var(--line); }
  table.matrix th[scope="row"] { font-weight:650; white-space:nowrap; }
  table.matrix td { font-variant-numeric:tabular-nums; vertical-align:top; }
  table.matrix tbody tr { transition:background-color var(--mid); }
  table.matrix tbody tr:hover { background:color-mix(in srgb, var(--fg) 4%, transparent); }
  .cv { display:block; font-weight:600; }
  /* The matrix has no glyph column of its own, so the winning cell wears the
     same tick the grouped rows get. */
  td.win .cv::after { content:" ✓"; color:var(--accent); }
  .u { display:block; height:4px; max-width:7rem; margin-top:.3rem; border-radius:2px;
       background:color-mix(in srgb, var(--fg) 8%, transparent); }
  .u b { display:block; height:100%; border-radius:2px; background:var(--accent);
       transform-origin:left; animation:grow .45s var(--ease) .1s backwards; }
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
  #scheme { position:fixed; top:1rem; right:1.25rem; z-index:1; width:2rem; height:2rem;
            display:grid; place-items:center; padding:0; font:inherit; font-size:.9rem;
            line-height:1; cursor:pointer; border:1px solid var(--line); border-radius:50%;
            background:var(--card); color:var(--mut);
            transition:color var(--mid), border-color var(--mid); }
  #scheme:hover { color:var(--fg); border-color:var(--accent); }
  #scheme[hidden] { display:none; }
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
  /* Prose is one size throughout a briefing. A lead paragraph set larger than
     the paragraph under it reads as two type scales in one block; code and
     tables step down because they are data, not prose. */
  .md-p { margin:0 0 .7rem; font-size:.875rem; }
  /* The question briefing opens with the TL;DR, so it gets the gap that sets
     it off from the detail. Spacing only: prose is one size and one ink
     throughout, so nothing here changes either. */
  section > .brief > .md-p:first-child { margin-bottom:.9rem; }
  .brief h4 { margin:1rem 0 .4rem; font-size:.8rem; font-weight:650;
           color:var(--mut); text-transform:uppercase; letter-spacing:.04em; }
  .md-list { margin:0 0 .7rem; padding-left:1.1rem; font-size:.875rem; }
  .md-list li { margin:.15rem 0; }
  /* A trade-off list. The glyph carries the valence and the color only
     reinforces it: red and green collapse under deuteranopia, plus and minus
     do not. Text keeps its inherited ink, so a card of cons is no harder to
     read than a card of pros. */
  .procon { list-style:none; padding-left:0; }
  .procon li { display:grid; grid-template-columns:.95rem 1fr; align-items:baseline; }
  .procon li::before { font-weight:700; }
  .procon .pro::before { content:"+"; color:var(--pro); }
  /* U+2212, not a hyphen: it matches the plus in width and optical weight. */
  .procon .con::before { content:"\\2212"; color:var(--con); }
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
  /* No reserved height: the block already holds its own source, so it occupies
     space before mermaid runs and a floor would only pad the fallback. The
     reduced-motion reset below covers what mermaid injects — it wears
     !important, which beats mermaid's own stylesheet whatever the order. */
  .mermaid { margin:0 0 .8rem; display:grid; place-items:center; }
  .mermaid svg { max-width:100%; height:auto; }
  /* Until mermaid claims it, the block is its own source: shown as code so a
     diagram that never renders — bad syntax, missing bundle, blocked script —
     is still readable. */
  .mermaid:not([data-processed]) { display:block; white-space:pre-wrap;
     font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8rem;
     padding:.7rem .85rem; border-radius:7px;
     background:color-mix(in srgb, var(--fg) 5%, transparent); }
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

// A card's rows already scale against every option's values, so a declared
// direction marks the winner here too rather than only inside a chart block.
function barRows(o, scale, winners) {
  return o.metrics
    .map((m) => `<div class="metric"><span class="k">${esc(m.key)}</span>
            ${markCell(m, scale, rankOf(m, winners), winners?.dir.get(m.key))}</div>`)
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
  const metrics = options.map((o) => o.metrics);
  const scale = scalesFor(metrics);
  // After scalesFor, which is what normalizes the values this compares.
  const winners = winnersFor(metrics);
  const multi = q.multiSelect === true;
  const requested = options.map((o) => o.chart).find(Boolean) || 'bars';

  // pickForm guards the data shape, but a renderer can still throw on an edge
  // the shape check misses. Losing the whole page over one exotic chart is
  // worse than one question falling back to bars.
  let form = 'bars';
  let chart = '';
  try {
    const picked = pickForm(requested, options);
    chart = renderChart(picked.name, options, scale, picked.shape, winners);
    form = picked.name;
  } catch {
    form = 'bars';
    chart = '';
  }

  // An option with no metrics renders no metric block. Naming the absence
  // costs a line and tells the reader nothing the empty card doesn't.
  const bodyFor = (o) => (form === 'bars' ? barRows(o, scale, winners) : '');
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

// Hidden by default: without light-dark() the button would set a property no
// token reads, so the script unhides it only once support is confirmed.
const SCHEME = `<button id="scheme" type="button" hidden
  aria-label="Switch between light and dark"></button>`;

const FOOTER = `<footer><span id="status">Pick an option.</span>
<button id="jump" type="button" hidden></button>
<button id="cancel" type="button">Answer in terminal</button>
<button id="send" disabled>Send answer</button></footer>`;


function renderPage(questions, { nonce = '', waitMs = 0 } = {}) {
  const body = questions.map((q, qi) => renderQuestion(q, qi)).join('');
  // One substring test beats threading a flag back out of renderMd through two callers.
  const mermaid = body.includes('class="mermaid"') ? mermaidScript() : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Answer the question</title>
<style>${STYLES}</style></head><body>${SCHEME}<main>${body}</main>
${FOOTER}${pageScript(nonce, questions.length, waitMs)}${mermaid}
</body></html>`;
}

module.exports = { renderPage, prepareOptions };
