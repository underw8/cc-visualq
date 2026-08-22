#!/usr/bin/env node
// PreToolUse:AskUserQuestion — serve the options as an HTML comparison with
// clickable cards, block until you pick, then answer the tool directly.
//
// The terminal dialog can't render HTML, so the page is served over a loopback
// HTTP server and the answer comes back as a POST. Returning "allow" with an
// `answers` map in updatedInput is the only way to satisfy AskUserQuestion
// without the dialog; "allow" alone is not sufficient for this tool.
//
// Two invariants:
//   1. Never answer on the user's behalf. Any path that isn't an explicit click
//      must emit nothing, so the terminal dialog takes over unchanged. A hook
//      that times out renders no decision and the tool continues through the
//      normal permission flow, so silence is a safe fallback.
//   2. Only a request bearing the nonce may answer. The port is guessable; the
//      nonce is what ties a POST to this specific question.

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { openUrl } = require('./lib/launch.js');
const { stripTags } = require('./lib/metrics.js');
const { renderPage } = require('./lib/render.js');

// Must stay below the hook's configured `timeout` so the process exits on its
// own terms and the dialog appears, rather than being killed mid-write.
const WAIT_MS = 240_000;
// The launcher reports that it ran, not that a browser appeared — `cmux
// disable-browser` exits 0 showing nothing, and `open` reports nothing at all.
// A page nobody has fetched by now is a page nobody will answer.
const ARRIVE_MS = 10_000;

function respond(out) {
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// Emitting nothing means "no decision": the terminal dialog handles the question.
const passThrough = () => respond(null);

function main(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return passThrough();
  }
  const questions = input?.tool_input?.questions;
  if (!Array.isArray(questions) || questions.length === 0) return passThrough();

  // The tag is display-only metadata; strip it whichever path answers.
  const { questions: cleaned, hasMetrics, hasBrief } = stripTags(questions);
  // With neither a metric tag nor a briefing the page shows exactly what the
  // terminal dialog already does, so opening a browser is pure interruption.
  if (!hasMetrics && !hasBrief) return passThrough();

  const nonce = crypto.randomBytes(16).toString('hex');
  const html = renderPage(questions, { nonce, waitMs: WAIT_MS });

  // A page that sent something unusable (bad nonce, unknown label, partial set)
  // gets one chance; hanging on for the full wait would stall the dialog behind
  // a browser that already had its turn. Give the response time to flush first.
  let settled = false;
  const giveUp = () => {
    if (settled) return;
    settled = true;
    setTimeout(() => {
      try { server.close(); } catch {}
      passThrough();
    }, 50).unref();
  };

  // A body over the cap is rejected by destroying the request, and `end`
  // never fires on a destroyed request — so the guard itself must settle
  // the hook, or an oversized POST would wait out the full WAIT_MS untouched.
  let arrived = false;

  const tooBig = (req, res, cap) => (buf) => {
    if (buf.length <= cap) return false;
    try { res.writeHead(413).end(); } catch {}
    req.destroy();
    giveUp();
    return true;
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      arrived = true;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    // The page polls this to notice the hook is gone — aborted with Ctrl-C,
    // or answered in the terminal — and stop waiting on a dead server.
    if (req.method === 'GET' && req.url.startsWith('/ping')) {
      res.writeHead(204);
      return res.end();
    }
    // Handing back needs no nonce: it settles the hook the same way whatever
    // the body says, and the only outcome is the question the terminal dialog
    // would have asked anyway. The body is read solely to bound its size.
    if (req.method === 'POST' && req.url.startsWith('/cancel')) {
      let cbuf = '';
      const guard = tooBig(req, res, 4_000);
      req.on('data', (c) => { cbuf += c; guard(cbuf); });
      req.on('end', () => { res.writeHead(204).end(); giveUp(); });
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/answer')) {
      res.writeHead(404).end();
      return;
    }
    let buf = '';
    const guard = tooBig(req, res, 64_000); // no unbounded body from a local page
    req.on('data', (c) => { buf += c; guard(buf); });
    req.on('end', () => {
      let picked, other, notes;
      try {
        const parsed = JSON.parse(buf);
        // Timing-safe compare on equal-length hex strings.
        const a = Buffer.from(String(parsed.nonce || ''));
        const b = Buffer.from(nonce);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          res.writeHead(403).end();
          giveUp();
          return;
        }
        ({ picked, other, notes } = parsed);
      } catch {
        res.writeHead(400).end();
        giveUp();
        return;
      }
      res.writeHead(204).end();
      if (settled) return;

      // Free text is the user's own words, so it bypasses the label set. That
      // is not "inventing a label": nothing here originates from the model.
      const CAP = 2000;
      const text = (v) => (typeof v === 'string' ? v.slice(0, CAP).trim() : '');

      const answers = {};
      const annotations = {};
      for (let qi = 0; qi < questions.length; qi++) {
        const q = cleaned[qi];
        const labels = Array.isArray(picked?.[qi]) ? picked[qi] : [];
        const valid = new Set((q.options || []).map((o) => o.label));
        const parts = labels.filter((l) => valid.has(l)); // never invent a label
        const free = text(other?.[qi]);
        if (free) parts.push(free);
        if (!parts.length) continue;
        answers[q.question] = parts.join(', ');
        const note = text(notes?.[qi]);
        if (note) annotations[q.question] = { notes: note };
      }

      // A partial answer would silently drop a question; let the dialog handle it.
      if (Object.keys(answers).length !== questions.length) return giveUp();

      settled = true;
      server.close();
      respond({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: {
            questions: cleaned,
            answers,
            ...(Object.keys(annotations).length && { annotations }),
          },
          permissionDecisionReason: 'Answered in browser',
        },
      });
    });
  });

  server.on('error', passThrough); // port unavailable: fall back to the dialog

  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/?n=${nonce}`;
    // No usable launcher means nothing can ever answer here; hand off now
    // instead of blocking for the full wait.
    if (!openUrl(url)) return passThrough();
    // ponytail: one flag, no request tracking. Set by the page fetch below.
    setTimeout(() => { if (!arrived) giveUp(); }, ARRIVE_MS).unref();
    // ponytail: single timer, no keep-alive tracking. If the browser never
    // answers, the dialog does.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        passThrough();
      }
    }, WAIT_MS).unref();
  });
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  try {
    main(stdin);
  } catch {
    passThrough();
  }
});
