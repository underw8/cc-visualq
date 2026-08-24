'use strict';

// The page's own script: what the browser runs once the comparison is on
// screen. Kept out of render.js because it is browser JavaScript inside a
// template, not markup assembly.
//
// Every write to innerHTML here is a fixed literal. Anything derived from an
// answer reaches the DOM through textContent — option labels and question text
// are model-generated and may carry injected content.

const pageScript = (nonce, count, waitMs) => `<script>
(function () {
  var NONCE = ${JSON.stringify(nonce)}, NEED = ${count};
  var DEADLINE = Date.now() + ${waitMs};
  var picked = Object.create(null);           // qIndex -> [labels]
  var other = Object.create(null), notes = Object.create(null);
  var cancel = document.getElementById('cancel');
  var status = document.getElementById('status'), send = document.getElementById('send');
  var jump = document.getElementById('jump'), gap = null;

  var expired = false, finished = false, tick = 0;

  // The reader's own scheme choice. prefers-color-scheme cannot be overridden
  // from CSS, so the pick is written as color-scheme on the root and every
  // light-dark() token follows it. Nothing persists it: the port changes with
  // every question, so localStorage is a different origin each time and would
  // never be read back. The OS remains the default.
  var root = document.documentElement, scheme = document.getElementById('scheme');
  if (CSS.supports('color', 'light-dark(#fff,#000)')) {
    var osDark = window.matchMedia('(prefers-color-scheme: dark)');
    var current = function () {
      return root.dataset.scheme || (osDark.matches ? 'dark' : 'light');
    };
    var paint = function () {
      // Names the scheme it switches to, not the one showing.
      var to = current() === 'dark' ? 'light' : 'dark';
      scheme.textContent = to === 'dark' ? '\u263d' : '\u2600';
      scheme.title = 'Switch to ' + to;
    };
    scheme.hidden = false;
    paint();
    // Following the OS again once the reader has chosen is not worth a third
    // state on a page that lives four minutes.
    osDark.addEventListener('change', paint);
    scheme.addEventListener('click', function () {
      root.dataset.scheme = current() === 'dark' ? 'light' : 'dark';
      paint();
      // Mermaid bakes computed colors into the SVG at render time and rejects
      // a var(), so a diagram cannot follow the toggle. The hook that
      // redraws it exists only on a page that loaded the bundle.
      if (window.__askqRetheme) window.__askqRetheme();
    });
  }

  function sections() { return document.querySelectorAll('section[data-q]'); }

  // A single-select card reports its state as a radio, a multiSelect card as a
  // toggle. One writer so the two attributes never diverge.
  function setPressed(card, on) {
    var attr = card.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed';
    card.setAttribute(attr, on ? 'true' : 'false');
  }

  function answered(s) {
    var q = s.dataset.q;
    return !!((picked[q] && picked[q].length) || (other[q] && other[q].trim()));
  }

  function secsLeft() { return Math.max(0, Math.round((DEADLINE - Date.now()) / 1000)); }

  function left() {
    var s = secsLeft();
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function refresh() {
    if (expired) return;
    var done = 0;
    gap = null;
    sections().forEach(function (s) {
      if (answered(s)) done++;
      else if (!gap) gap = s;
    });
    send.disabled = done < NEED;
    // The remaining time is a deadline, not a stopwatch: it earns footer space
    // only once it is short enough to act on.
    status.textContent = (done < NEED
      ? 'Answered ' + done + ' of ' + NEED + '.'
      : 'Ready to send.') + (secsLeft() < 60 ? '  \\u00b7  ' + left() + ' left' : '');
    // Question text is model-generated: textContent only.
    jump.hidden = !gap;
    jump.textContent = gap ? clip(gap.querySelector('h2').textContent.trim()) : '';
  }

  function clip(text) {
    return text.length > 60 ? text.slice(0, 59) + '\\u2026' : text;
  }

  // One heartbeat drives everything time-based. The server stops listening at
  // the deadline; say so instead of letting a click fail silently.
  setInterval(function () {
    if (finished || expired) return;
    if (Date.now() >= DEADLINE) {
      expired = true;
      send.disabled = true;
      status.textContent = 'Expired \\u2014 answer in the terminal.';
      return;
    }
    refresh();
    // Ctrl-C or an answer given in the terminal takes the hook away without
    // telling the page. Poll every third beat, rather than waiting out the
    // full deadline on a server that has gone.
    if (++tick % 3 === 0) {
      fetch('/ping').catch(function () {
        finish('This question is no longer waiting.');
      });
    }
  }, 1000);

  document.querySelectorAll('button.card').forEach(function (card) {
    card.addEventListener('click', function () {
      var q = card.dataset.q;
      var multi = card.closest('section').dataset.multi === 'true';
      picked[q] = picked[q] || [];
      if (multi) {
        var at = picked[q].indexOf(card.dataset.label);
        if (at === -1) { picked[q].push(card.dataset.label); setPressed(card, true); }
        else { picked[q].splice(at,1); setPressed(card, false); }
      } else {
        card.closest('.grid').querySelectorAll('button.card').forEach(function (c) {
          setPressed(c, false);
        });
        setPressed(card, true);
        picked[q] = [card.dataset.label];
        var own = card.closest('section').querySelector('.other input');
        if (own) { own.value = ''; other[q] = ''; }
      }
      refresh();
    });
  });

  document.querySelectorAll('.other input').forEach(function (input) {
    input.addEventListener('input', function () {
      var q = input.dataset.q;
      other[q] = input.value;
      // In a single-select question, typing your own answer clears the cards.
      var section = input.closest('section');
      if (input.value.trim() && section.dataset.multi !== 'true') {
        section.querySelectorAll('button.card').forEach(function (c) {
          setPressed(c, false);
        });
        picked[q] = [];
      }
      refresh();
    });
  });

  document.querySelectorAll('textarea.notes').forEach(function (area) {
    area.addEventListener('input', function () { notes[area.dataset.q] = area.value; });
  });

  // Which question a digit press means. Cheap and local: the only question if
  // there is one, otherwise where the focus is, otherwise whatever is nearest
  // the top of the viewport.
  function targetSection() {
    var all = sections();
    if (all.length === 1) return all[0];
    var focused = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('section[data-q]') : null;
    if (focused) return focused;
    var best = null, nearest = Infinity;
    all.forEach(function (s) {
      var d = Math.abs(s.getBoundingClientRect().top);
      if (d < nearest) { nearest = d; best = s; }
    });
    return best;
  }

  // The audience answers these in a terminal. Cards stay real buttons, so
  // plain Enter is left to the browser.
  document.addEventListener('keydown', function (e) {
    if (finished || expired) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { cancel.click(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (!send.disabled) send.click();
      return;
    }
    if (e.key < '1' || e.key > '4' || e.metaKey || e.ctrlKey || e.altKey) return;
    var section = targetSection();
    var card = section && section.querySelectorAll('button.card')[Number(e.key) - 1];
    if (card) { e.preventDefault(); card.click(); }
  });

  // Every ending lands here: sent, handed back, or the hook went away. The
  // markup is a fixed literal and the words arrive through textContent.
  function finish(headline) {
    finished = true;
    document.body.innerHTML =
      '<main style="text-align:center;padding-top:4rem">' +
      '<h2 id="head"></h2><p id="bye" style="color:var(--mut)"></p></main>';
    document.getElementById('head').textContent = headline;
    var left = 3, bye = document.getElementById('bye');
    (function tick() {
      bye.textContent = left > 0 ? 'Closing in ' + left + '\\u2026'
                                 : 'You can close this tab.';
      if (left-- > 0) setTimeout(tick, 1000); else window.close();
    })();
  }

  jump.addEventListener('click', function () {
    if (!gap) return;
    gap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var first = gap.querySelector('button.card');
    if (first) first.focus();
  });

  // Send carries no confirmation step: the selection is on screen, the button
  // is disabled until every question has an answer, and the terminal dialog
  // this page stands in for does not confirm either.
  send.addEventListener('click', function () {
    send.disabled = true; status.textContent = 'Sending\\u2026';
    fetch('/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: NONCE, picked: picked, other: other, notes: notes })
    }).then(function () {
      finish('Answer sent \\u2014 back to the terminal.');
    }).catch(function () {
      // The server is gone: the wait elapsed or the question was already
      // answered in the terminal. Nothing to retry against.
      send.disabled = true;
      status.textContent =
        'This question is no longer waiting \\u2014 it will be asked in the terminal.';
    });
  });

  cancel.addEventListener('click', function () {
    cancel.disabled = true; send.disabled = true;
    status.textContent = 'Handing back…';
    fetch('/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: NONCE })
    }).then(function () {
      finish('Answer this one in the terminal.');
    }).catch(function () {
      finish('Answer this one in the terminal.');
    });
  });
})();
</script>`;

// Emitted only when a briefing actually holds a mermaid block, because the
// bundle is 3.4MB and every question would otherwise pay for it.
//
// Three things this must get right. `run` given a config object replaces the
// defaults wholesale rather than merging, so omitting `querySelector` leaves
// mermaid with nothing to select and it throws — and `suppressErrors` then
// swallows the throw, leaving a blank page and no clue. `suppressErrors` also
// does not stop the error card, only the exception, so bad syntax is caught by
// parse() first. And the theme is read off the live custom properties rather
// than restated here, so the diagram follows the page into dark mode and no
// hex is written down twice.
const mermaidScript = () => `<script src="/mermaid.min.js"></script>
<script>
(function () {
  if (typeof mermaid === 'undefined') return;
  // Custom properties are substitution-only: getPropertyValue('--fg') hands
  // back the literal text, which since the tokens became light-dark() means
  // mermaid would receive "light-dark(#1f1e1c,#f5f4ef)", fail to parse it and
  // fall back to its own grey. Assigning through a probe forces the resolve:
  // a computed color is an rgb(), and light-dark() collapses at that point
  // against whichever color-scheme is in force.
  var probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  var v = function (n) {
    probe.style.color = 'var(' + n + ')';
    return getComputedStyle(probe).color;
  };
  // Read fresh each pass: after the toggle these resolve to the other scheme.
  var config = function () {
    return {
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      theme: 'base', fontFamily: 'ui-sans-serif,-apple-system,system-ui,sans-serif',
      themeVariables: {
        background: v('--card'), primaryColor: v('--card'),
        primaryTextColor: v('--fg'), primaryBorderColor: v('--mut'),
        secondaryColor: v('--bg'), tertiaryColor: v('--bg'),
        lineColor: v('--mut'), textColor: v('--fg')
      }
    };
  };

  // run() replaces each block's text with an SVG, so the authored source has to
  // be kept aside before the first pass or a redraw has nothing to parse.
  var blocks = [].slice.call(document.querySelectorAll('.mermaid'))
    .map(function (el) { return { el: el, src: el.textContent }; });

  // suppressErrors stops the throw, not the error card mermaid draws in its
  // place — a mistyped diagram would replace itself with a red box. parse()
  // under the same flag returns false and draws nothing, so every block is
  // checked before run() is allowed near it. One that fails keeps its escaped
  // source, and the styling that renders it as code.
  //
  // run() given a config replaces the defaults wholesale rather than merging,
  // so omitting querySelector leaves mermaid nothing to select and it throws —
  // and suppressErrors then swallows that, leaving a blank page and no clue.
  // The two keys are always named together.
  function draw() {
    mermaid.initialize(config());
    return Promise.all(blocks.map(function (b) {
      return mermaid.parse(b.src, { suppressErrors: true })
        .then(function (parsed) {
          if (parsed === false) b.el.setAttribute('data-bad', '');
        });
    })).then(function () {
      return mermaid.run({
        querySelector: '.mermaid:not([data-bad])', suppressErrors: true
      });
    });
  }

  draw();

  // Mermaid cannot theme off custom properties: it writes computed hex into the
  // SVG and discards a var() outright, falling back to its own grey. So the
  // only way a diagram follows the toggle is a redraw from the stashed source.
  window.__askqRetheme = function () {
    blocks.forEach(function (b) {
      b.el.textContent = b.src;
      b.el.removeAttribute('data-processed');
      b.el.removeAttribute('data-bad');
    });
    draw();
  };
})();
</script>`;

module.exports = { pageScript, mermaidScript };
