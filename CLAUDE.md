# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# cc-visualq

Claude Code plugin. A `PreToolUse` hook on `AskUserQuestion` renders the options
as an HTML comparison chart in the terminal's embedded browser.

## Commands

```sh
make test            # all nine suites (./test/run-all.sh)
make validate        # claude plugin validate .
make check           # test + validate
```

Suites need `node` and `bash`; no npm dependencies, no framework. Run one suite by
invoking it directly — `node test/test-metrics.js`, `node test/test-md.js`,
`node test/test-vscode.js`, `node test/test-render.js`, `node test/test-launch.js`,
`node test/test-askq.js`, `node test/test-devhooks.js`, `./test/test-install.sh`.
Only `test-install.sh` needs the `claude` CLI.
There is no test-name filter, so narrowing further means commenting out sections.

`make validate` after touching either manifest. It is not an install check —
it passes on a manifest that makes every install fail to load — so the real
coverage is `./test/test-install.sh`, which installs a throwaway clone of HEAD and
asserts the load status. `claude plugin install` exits 0 and prints success even
when the plugin then fails to load, so the status has to come from
`claude plugin list`.

## Two install modes

`make dev-install` writes both a `PreToolUse` hook (pointing at
`${CLAUDE_PROJECT_DIR}/hooks/askq.js`) and the `SessionStart` rule hook to
`.claude/settings.local.json`. A rule registered in only one install
mode leaves the other without it. It reads the working tree, so a hook edit
takes effect on the next question with no reinstall. Only fires in sessions
started inside this repo, and the file is gitignored.

`make install` does the real thing: registers the self-hosted marketplace and
installs the plugin. This copies the repo into
`~/.claude/plugins/cache/cc-visualq/cc-visualq/<version>/` — a **snapshot**, not
a live view, and `claude plugin marketplace update` does not refresh it. Re-run
`make install` after every hook edit. Only this mode exercises the manifest,
`${CLAUDE_PLUGIN_ROOT}`, and marketplace resolution, so run it once before a
release.

Never both at once: hooks from every source run in parallel, so two
registrations open two pages per question. Each target clears the other;
`make uninstall` clears both.

**`.claude/settings.local.json` is the developer's file, not ours.** Their
permissions, env and MCP settings live in the same file as our two hook
entries, so `scripts/dev-hooks.js` merges and prunes by matching the hook path
in each command, rather than writing or deleting the file whole. `make install`
runs `dev-uninstall`, so a whole-file `rm` there would take a developer's
unrelated settings with it every time they installed the plugin. A file that
cannot survive `JSON.parse` is refused rather than overwritten, the same
bargain `lib/vscode.js` strikes with `.vscode/settings.json`. `add` prunes
before it appends, so re-running it replaces our entries instead of stacking a
second registration.

## Layout

```
.claude-plugin/plugin.json       manifest; no `hooks` key (see below)
.claude-plugin/marketplace.json  self-hosting catalog (source: "./")
hooks/hooks.json                 registrations: PreToolUse + SessionStart
hooks/askq-rule.md               option-authoring rule, injected at session start
hooks/askq.js              loopback server, blocks, answers the tool
hooks/lib/render.js              the page: styles, cards, assembly
hooks/lib/page-script.js         the browser script the page runs
hooks/lib/charts.js              the three chart forms and form selection
hooks/lib/esc.js                 HTML escaping, shared by render and charts
hooks/lib/md.js                  the briefing markdown subset
hooks/lib/launch.js              browser launcher selection and spawn
hooks/lib/vscode.js              VS Code browser launcher, stub + settings
hooks/lib/metrics.js             tag parsing and stripping, units, bar widths
scripts/dev-hooks.js             dev-install registration, merged not written
vendor/mermaid.min.js            pinned diagram library, served by the hook
vendor/README.md                 version, hash, and what to re-check on a bump
test/run-all.sh                  runs all nine suites
test/test-load.js                every lib module parses; runs first
test/test-md.js                  the subset and its escaping
```

Metric parsing and scaling live in `lib/metrics.js`; browser launch in
`lib/launch.js`. Markup has three owners: `render.js` the page shell and the
cards, `charts.js` chart bodies, `md.js` briefing bodies. All three escape
through the one `esc.js`. `page-script.js` is not a fourth: it emits the
browser script, not markup. A styling change belongs in exactly one place. A
change to parsing or bar widths belongs in `lib/metrics.js` only.

`stripTags` strips the tag and reports whether a metric tag or a briefing was
present, which is what decides whether a page opens at all: `askq.js` hands
back before it listens when neither is there. `esc.js` is a single export in its own file because
`charts.js` and `render.js` both need it and neither may require the other.

## Non-obvious constraints

**`plugin.json` must not declare a `hooks` key.** `hooks/hooks.json` is loaded
automatically from its standard path; naming it again makes the plugin fail to
load outright with `Duplicate hooks file detected`. The key is only for
*additional* hook files. `claude plugin validate .` does not catch this — a real
`claude plugin install` does.

**`updatedInput` replaces the entire tool input.** Partial objects drop fields.
Echo `questions` back whole, always.

**`permissionDecision: "allow"` on `AskUserQuestion` skips the dialog entirely.**
It is only correct when paired with an `answers` map the user actually chose.
`"allow"` alone is not sufficient for this tool. Use `"ask"` to modify input while
keeping the user in the loop.

**Only `/answer` checks the nonce.** It is the one route that speaks for the
user, so it is the one route worth authenticating. `/cancel` settles the hook
identically whatever it carries — the outcome is the question the terminal
dialog would have asked anyway — so a nonce there would gate a status code
nobody reads. Both routes still cap the body they accept.

**The page has one ending, reached three ways.** Sending, handing back, and
noticing the hook has gone all land in `finish()`, which writes a fixed literal
and sets the words through `textContent`, then counts down and calls
`window.close()`. One 1s interval drives every timed thing on the page: the
countdown, the expiry, and a `/ping` on every third beat. The ping is there
because an aborted hook — Ctrl-C, or a question answered in the terminal —
closes the server without telling the browser, and waiting out the full 240s
deadline leaves a dead page on screen.

**A question with no metric tag and no briefing opens no page.** `askq.js`
hands back before it binds a port, so no browser appears and the terminal
dialog asks unchanged — the page would otherwise show exactly what the dialog
already does, at the cost of a window. `hasMetrics`/`hasBrief` from `stripTags`
are what decide it; a page that always opened would make both dead fields.

**A `PreToolUse` hook that exits 0 has no channel to the user but its JSON.**
Both stdout and stderr are discarded on exit 0; exit 2 shows stderr to the model
and blocks the call; any other code shows stderr to the user but discards the
decision. So a diagnostic written to stderr beside a normal answer is never
read by anyone — the only route is `systemMessage` in the JSON, which is shown
to whoever is answering the question rather than to whoever maintains the rule.
A lint was built on stderr and deleted for exactly this.

**Emitting nothing is the safe fallback.** A `PreToolUse` command hook that times
out or writes no JSON renders no decision, and the call continues through the
normal permission flow — the terminal dialog answers as usual. Every rejection
path in `askq.js` must reach `passThrough()` or `giveUp()`; never answer on
the user's behalf and never hold the process waiting once the page has had its
turn (a rejected POST that keeps waiting stalls the dialog for the full 240s).

**`WAIT_MS` must stay below the hook entry's `timeout`.** Otherwise Claude Code
kills the process mid-write instead of letting it exit and hand off. `WAIT_MS`
is 240s and `hooks/hooks.json` ships `timeout: 300`. `ARRIVE_MS` is the other
half: ten seconds with nothing fetching the page means no browser is coming, so
the hook hands back rather than holding the dialog for the full wait.

**The launch attempt is the probe.** `TERM_PROGRAM` lies: a cmux window running
a Ghostty profile reports `iTerm.app`, and a session under the VS Code extension
host reports `ghostty` while sitting inside both. `cmux open` exits non-zero when
it fails, so `openUrl` runs it synchronously (~100ms) and falls through to the OS
handler on failure. There is no separate probe command to keep honest.

**`cmux open` takes a path, never a `file://` URL.** It does not recognise the
scheme, reads the string as a relative path, joins it to the cwd and normalises
`///` to `/`. The scheme comes off before the argument is handed over; an
`http://` URL passes through untouched.

**`CMUX_SURFACE_ID` outlives the surface it names.** A process tree that started
in a cmux terminal keeps the id after that surface is replaced — a VS Code window
launched from cmux is the common case — and `cmux open` then fails with `Error:
not_found: Source surface not found`. The id and `CMUX_PANEL_ID` are dropped from
the child env; `CMUX_WORKSPACE_ID` survives a respawn and still places the tab.

**A missing launcher binary crashes the hook unless the child is handled.**
`spawn` reports it through an async `error` event rather than a throw, so the
`try/catch` around it never fires. Every detached child gets an `error`
listener.

**No iTerm2 launcher, and the research is done.** iTerm2's embedded browser is
real (3.6.0+, WKWebView, needs the browser plugin), but URL routing into it
landed after 3.6.11 and is only in 3.7 betas — and it is wired to the system
handler, so `open` reaches it once shipped.

**The VS Code launcher writes to the workspace while a page opens.** `code` cannot be
handed a URL: the browser editor registers the `file` scheme only. A stub file
is rendered instead and navigates itself to the loopback page. Which editor
opens it is decided by `workbench.editorAssociations`, which no CLI can read
back, so `lib/vscode.js` writes the entry, opens, waits for the editor to read
it, and puts the file back byte for byte. The browser refuses any file outside a
trusted root — `os.tmpdir()` is not one, the open workspace folder is — so both
the stub and the settings live under `CLAUDE_PROJECT_DIR`.

The browser editor stays bound to the file it opened, so navigating away puts
the page in a *new* tab and leaves the stub tab behind. The stub closes itself
800ms after the handoff — the editor honours `window.close()`, which Chrome
does not.

Two consequences. Trust is per workspace folder: when `CLAUDE_PROJECT_DIR` is
not the folder VS Code has open, `code` still exits 0 and the page reads
`Forbidden. File does not reside within a trusted folder.` — the one failure the
launcher cannot detect and report. A settings file that cannot survive
`JSON.parse`/`stringify` — comments, trailing commas, both legal in VS Code — is
left untouched and the launcher declines. And a crash between writing and
restoring leaves `.vscode/.askq-restore.json` naming what to put back, which the
next call restores before doing anything else.

**A backtick anywhere inside `STYLES` or `pageScript`/`mermaidScript` breaks
the module.** Both are template literals, so a backtick in a *comment* inside
one closes the string and the file stops parsing. The failure surfaces three
suites away as `test-askq` reporting `expected "allow" got undefined`, because
the hook crashed before writing a decision. `test/test-load.js` requires every `lib/`
module for exactly this reason and runs first, so the broken file and line are
the first thing reported. It imports nothing at the top: a suite that requires
the thing it checks dies before it can report on it, which is why the guard is
its own suite rather than a section of `test-render.js`. Write `color-scheme`, not the backticked form, in any comment
that lives inside those literals.

**The scheme is a token-level choice, not two blocks.** `prefers-color-scheme`
cannot be overridden from CSS, so a scheme the reader picks has to arrive
through `color-scheme` — which is what `light-dark()` reads. Every two-scheme
token is one declaration, `--fg:light-dark(light,dark)`, preceded by a bare hex
so an engine without the function keeps the light theme rather than losing the
token to an invalid value. `--s3` stays single because that green clears both
surfaces. The toggle writes `data-scheme` on the root and nothing else; it is
hidden until `CSS.supports` confirms the function, since otherwise it would set
a property no token reads.

**Mermaid cannot read a custom property, so the toggle redraws it.** A custom
property is substitution-only: `getPropertyValue('--fg')` returns the literal
text, which since the tokens became `light-dark()` means mermaid receives
`light-dark(#1f1e1c,#f5f4ef)`, fails to parse it and falls back to its own
grey — themed nowhere, in either scheme. Passing `var(--fg)` fails the same
way and was measured doing so. The values are resolved through a hidden probe
element instead, because a computed `color` is an rgb() and the function
collapses at that point. Mermaid then bakes those numbers into the SVG, so a
diagram cannot follow the toggle on its own: `run()` replaces the block's text
with an SVG, the authored source is stashed before the first pass, and the
redraw restores it, clears `data-processed`/`data-bad` and re-runs. The hook is
only defined on a page that loaded the bundle.

**Nothing persists the reader's scheme.** The port changes with every question,
so `localStorage` is a different origin each time and would never be read back.
The OS stays the default and the pick lasts one page.

**Option text is model-generated and reaches the browser.** Everything
interpolated into HTML goes through `esc()`. Every `innerHTML` write in the
page script assigns a fixed literal with no interpolation; anything derived
from an answer reaches the DOM through `textContent` — the closing headline and
the question heading the footer's jump link names, alike.

**`chart` is a reserved key in the metric tag.** It names the comparison form,
is stripped before rendering, and an option whose genuine metric is called
`chart` loses it. The first option declaring it wins; later declarations are
ignored. A form whose data can't carry it degrades silently — `grouped` and
`matrix` to `bars`. A retired name (`radar`, `scatter`) is an unknown name and
lands on `bars` too, so an option authored against an older rule still renders.

**No axis-per-key form, and the reasoning is the reason.** Radar and scatter
were built and removed. A vertex at the centre and a missing vertex look
identical, so both refused any key an option lacked and any spread over 10:1 —
which meant the honest cases were the ones they declined. `AskUserQuestion`
caps a question at four options and the rule caps keys at four, so the largest
possible dataset is sixteen numbers, and `matrix` states all sixteen. Adding one
back means re-adding the `completeNumeric` gate, the readability gate, finite
clamping on every SVG coordinate, and a manual check for label collisions that
never show up in the markup.

**An ambiguous unit takes its dimension from its siblings.** `m` is minutes in
a duration and millions in a count; `b` is bytes or billions. `resolveDimensions`
scans every option's value under one key to decide, so `{stars:2m}` beside
`{stars:500k}` reads as millions and `{t:30m}` beside `{t:2h}` reads as minutes.
Without that scan `2m` falls to whichever table matches first — minutes — and
draws a bar 240x too long beside `500k`. Two firm dimensions under one key
(`4mb` and `2s`) clear the dimension instead, so the raw numbers rank.

**A value may carry a trailing `/period`.** `$12/mo` is the rule's own first
example, and the unit charset excluded `/`, so it parsed as text and drew no
bar — the drift this section warns about, in the rule's headline case. The
period is dropped and the magnitude ranks; a key mixing a rate with a one-off
is already outside one-dimension-per-key.

**A direction is a property of the key, so the arrow comes off before keys are
compared.** `{size↓: 3kb}` on one option and `{size: 13kb}` on the next has to
land in one block, which it only does because `DIRECTED` strips the arrow in
`parseMetrics` and the first arrow seen under a key settles it for the column. A
key with no arrow is left unranked rather than guessed at — nothing in `3kb`
says small is good, and inferring it from the unit is wrong the first time
someone charts throughput. Ties all win: two options at `low` are both best on
it, and `winnersFor` compares against one extreme rather than sorting.

**A win is three marks and the glyph is the load-bearing one.** The tick in
`.mark`, the value at full ink, and the fill keeping the accent while the losers
recede to `.dim` — neutral at 30% of ink, which is a lightness step from the
accent (1.94:1 light, 2.26:1 dark) rather than a hue away, so the pair survives
greyscale. The glyph is what carries it where neither reads. An ordinal is never
dimmed, because its value *is* its pill and the pill's ink is its band. Nothing
recedes on a question where no key declares a direction, so none of it fires by
accident.

**`hooks/askq-rule.md` is the contract for what the tables accept.** The rule
tells Claude which units and ordinal words to write, `UNITS` and `ORDINALS` in
`lib/metrics.js` accept that set, and README's value table documents it. A unit
added to one of the three and not the others is silent drift: a value outside
the tables still renders — as a bare number, or as text with no bar — so nothing
errors and only the bar is wrong.

**`AskUserQuestion` caps a question at four options.** `SERIES` in `charts.js`
is 4 for that reason, and its modulo is a backstop rather than a real cycle. A
`fits` predicate that bounds the option count bounds it against something the
tool cannot produce.

**There is no series palette; every bar is the one accent.** Identity comes
from the row label and the fixed row order that each block repeats, which is
what a per-option hue was restating. Deleting it also removed the light-mode
contrast relief the two lightest hues needed (2.06:1 and 2.56:1 on the card) and
a dark protan pair at ΔE 6.9. Adding a hue back means owning both again, and
a validator run against both surfaces with `--pairs all`.

**`--accent` is ink at one site and fill at another, so the fill has its own
ink.** Light enough to read as text on a card is too light for white text on top
of it: `#fff` over the dark accent measures 2.62:1, under the 4.5:1 floor the
Send button's label needs. `--on-accent` is that ink and `#send` and
`.tick::after` are the two sites that read it; a third filled accent site must
read it too. It is one value rather than a `light-dark()` pair because the
accent is mid-tone in both schemes (5.05:1 light, 7.50:1 dark) — an accent that
flipped lightness between schemes would need the pair.

**A chart block caps its track; a card does not.** `.metric` is emitted in both
places and the middle column is `1fr`, which inside a 64rem `main` leaves the
bar using under a third of the track and the value a viewport away from the bar
end. `.chart .metric` overrides the column to `20rem` for that reason; a card is
narrow enough that `1fr` already keeps the two adjacent.

**An ordinal carries two marks because it is two things.** It is a state, so it
states its word in a `.pill`; it is a place on a six-step scale, so it keeps a
`.track.ord` whose gaps are painted *over* the whole track in the surface color.
Segmenting the fill instead scales the pitch to the fill's own width and every
row then reads as a different scale. The pill's band comes from `BANDS` in
`charts.js`, indexed by rank: the vocabulary is itself a severity scale, so
`critical` is never good news whatever key it sits under and no declared
direction is needed. A key that wants `low` to read as good news is misusing the
vocabulary, not hitting a gap.

**`markCell` is the one owner of a metric row's marks.** `charts.js` exports it
and `barRows` in `render.js` calls it, so a card row and a chart row cannot
drift apart — the ordinal pill reached the cards for free. It always emits
exactly two grid children, which is what lets a missing value print an em dash
without collapsing the row's columns.

**In `matrix` the number is the mark and the bar is a rule beneath it.** Nothing
is read through a fill, which is what the old absolutely-positioned `.fill` at
`opacity:.22` did. An ordinal cell drops the rule entirely: a state has no
length.

**Motion is CSS, in one block, on three tokens.** `--ease`, `--fast` and
`--mid` are the whole vocabulary: a new hover or transition reuses them rather
than inventing a duration. The `prefers-reduced-motion` block ends the file and
must stay last — it clears `animation` and `transition` on `*`, `*::before` and
`*::after` and returns `scroll-behavior` to `auto`, so a rule added below it
would escape the reset. Nothing animates a property that reflows: the selected
card's left border is always 3px and only its color changes, and a bar's growth
is `scaleX` on an inline `width`.

**The recommended badge is display only.** `AskUserQuestion` marks a
recommendation by appending the words to the label, so `RECOMMENDED` in
`render.js` moves them into a badge in the heading and leaves `data-label`
verbatim — a stripped label fails the filter in `askq.js` and the question
falls through to the terminal. The badge never pre-presses the card.

**Free text bypasses the label set; clicks never do.** The label filter in
`askq.js` exists so the hook can't invent an option. Text the user typed
is not an invention, and is passed through verbatim up to 2000 characters.

**A briefing is split off before the metric tag is parsed.** `METRIC_TAG`
anchors on `\{…\}\s*$`, so a briefing ending in a code sample like
`{ retries: 3 }` would be read as metrics and lost. `splitBrief` runs first in
`stripTags` and in `prepareOptions`, which is what keeps the tag genuinely last
in what remains. The sentinel is authored *after* the tag for the same reason.

**A briefing holds a table, not a bar, and the alternatives were weighed.**
Charts stay the option comparison's job; the upgrade path, if ever wanted, is a
`chart:` fence whose rows parse with `parseMetrics` and render through
`renderChart` as pseudo-options, since the renderers accept any
`[{label, metrics}]`. Agent-authored HTML was rejected for the markdown subset:
a sandboxed iframe renders it inertly but cannot report its height, forcing
fixed-height cards, and a tag allowlist means owning a sanitizer and its
bypasses against text a prompt injection can reach.

**A `-` list is an ordinary list; one `+` in the run makes it a trade-off
list.** `-` is the normal bullet marker, so styling every `-` item as a
drawback would turn every briefing list into a list of drawbacks. `readList`
collects the whole run before deciding, because the deciding `+` can be its
last line. Ordered lists never qualify: `1.` carries sequence, not valence.

**The pro/con glyph carries the valence and the color only reinforces it.**
Red and green collapse under deuteranopia, `+` and `−` do not, so the rule that
matters is `content`, not `color`. `--pro`/`--con` are checked above 4.5:1 on
`--card` in both schemes and the item text keeps its inherited ink, so a card of
cons is no harder to read than a card of pros. The con glyph is U+2212, not a
hyphen: it matches the plus in width, which is what keeps a mixed run's text on
one left edge.

**`md.js` escapes before it substitutes.** `esc()` runs on the raw line and the
inline patterns run on the escaped string, so a model-written `<b>` arrives as
`&lt;b&gt;` and cannot be revived. Reversed, an authored tag passes through
intact. Links are absent from the subset deliberately: a `href` would need
scheme validation against `javascript:`, and a page that can navigate away
while `askq.js` waits is worse than a briefing without hyperlinks.

**The authoring rule is a four-place contract.** `hooks/askq-rule.md`,
`UNITS`/`ORDINALS`/`DIRECTED` in `lib/metrics.js`, the subset in `lib/md.js`
(including the `+`/`-` trade-off run), and README's tables must agree. A block type in `md.js` and not the rule is never authored;
one in the rule and not `md.js` renders as literal text. Neither errors.

**Mermaid reads `textContent`, which is why the escape stays.** A ```` ```mermaid ````
fence becomes `<div class="mermaid">` holding the same `esc()`-ed source every
other fence gets — `--&gt;`, not `-->`. The browser decodes entities on
`textContent`, so mermaid parses the authored text while the markup never held
a tag. Handing it raw source would be the only way to lose that, and it buys
nothing.

**`mermaid.run(config)` replaces the defaults instead of merging them.** Passing
`{suppressErrors: true}` alone drops `querySelector`, mermaid throws `Nodes and
querySelector are both undefined`, and `suppressErrors` then swallows the throw
— a blank page with nothing in the console. Both keys are always named
together.

**`suppressErrors` suppresses the exception, not the error card.** Mermaid still
replaces a mistyped diagram with its own red box, which reads as the plugin
breaking rather than the diagram being wrong. `parse(text, {suppressErrors:
true})` returns `false` and draws nothing, so every block is parsed first and
only what passes reaches `run` — the selector is
`.mermaid:not([data-bad])`. That, not `suppressErrors`, is what makes a bad
fence degrade to its own source.

**The bundle loads only for a page that holds a diagram.** It is 3.4MB; every
question would otherwise pay for it. `renderPage` tests the assembled body for
`class="mermaid"` rather than threading a flag out of `renderMd` through two
callers. The library is committed rather than installed because
`claude plugin install` copies files and never runs `npm install`, and it is
served from the hook rather than a CDN so no part of a briefing leaves the
machine. A missing bundle 404s and costs the diagram, not the question.

**A `.mermaid` block is styled as code until mermaid claims it.** The
`:not([data-processed])` rule is what makes a diagram that never renders — bad
syntax, absent bundle, blocked script — degrade to readable source instead of an
empty box. The reduced-motion reset needs no mermaid clause: it already wears
`!important` on `*`, which beats mermaid's injected stylesheet whatever the
order.

**`code` cannot open a URL, only a file.** Six `vscode://vscode.simple-browser/…`
forms produced zero fetches against a live server, and `code -r`, `--open-url`,
a bare URL and `-g` against an http URL produced zero between them. Simple
Browser registers no URI handler and the Claude Code extension's `open_url` is
not on its MCP surface. The one route in is a rendered `file://` page navigating
itself, which is what the stub does.

## Working here

Tests stub `open`/`cmux` on `PATH` and never launch a real browser. Two harness
traps, both already worked around — repeat them in new tests:

- A detached child is reaped by a command-substitution subshell before it writes.
  Run the hook in the current shell, redirect stdout to a file, read the file.
- Polling for the stub's log beats a fixed `sleep`; a slow launch otherwise lands
  in the *next* test and fails two at once.
- `test-install.sh` must clone HEAD and rename the marketplace. Marketplace names
  are global, so registering the working tree would clobber whichever install
  mode the developer is on and leave a registration pointing at a deleted temp
  dir. It also means the suite tests HEAD, not uncommitted work.

**The hook suites pin `CC_VISUALQ_OPEN` to their stub.** Without it `resolve()`
picks the first launcher whose probe succeeds, so a host with a working `cmux`
bypasses the stub and every assertion that greps the written page fails on a
missing file. Any new suite that exercises a hook end to end must set it too.

**End-to-end behaviour cannot be automated: `AskUserQuestion` does not exist in
headless mode.** It is absent from the tool set under `claude -p` in every
permission mode, loaded and deferred alike — the tool blocks on a human, so
there is nothing to drive. No suite covers what Claude Code does with the hook's
output; that needs a question asked in a real interactive session. Check by hand
after changing the decision shape:

1. Each form renders as named: `{chart: grouped|matrix}` with enough
   dimensions, and one option carrying no value for a shared key, which must
   print an em dash. A retired name (`{chart: radar}`) must arrive as bars.
2. An ordinal key draws a pill and a stepped track, and the fill lands on a
   segment boundary rather than inside one: `low` fills three of six, `critical`
   all six, `none` exactly one. Check a numeric key beside it draws no pill.
3. A direction: `{size↓: 3kb}` on the first option and `{size: 13kb}` on the
   next must land in one block, tick the smaller, dim the larger's value and
   fill, and print `lower is better` on the heading. Then `{reach↑: high}`
   against `{reach: none}` — `high` must read green, `none` red, since a
   declared direction outranks the vocabulary's own severity reading. Two
   options at the same value tick together. A key with no arrow must tick
   nothing, dim nothing, and grey no fill. Check the same question as `matrix`,
   where the tick is on the cell and the arrow on the column head.
4. Options with no tag: no page, dialog unchanged.
5. With `askq.js` wired in, clicking a card answers the tool; typing in
   "Something else" answers with that text verbatim; notes arrive alongside
   the answer; "Answer in terminal" dismisses the page and the dialog appears.
   Re-focusing the "Something else" field must not clear what was typed.
6. On a `multiSelect` question, click a card, click it again to deselect it,
   then select a third. The sent answer must contain exactly the labels left
   pressed.
7. Break the hook (`exit 1` at the top). The dialog still answers normally.
8. A question briefing renders above the chart and an option briefing inside
   its card, below the bars. An option briefing carrying a `+`/`-` run draws
   the plus and minus glyphs in both schemes, and a `-`-only run beside it
   still draws ordinary bullets. A question carrying a briefing and no metric tag
   still opens a page. A question with neither is unchanged. With
   `askq.js` wired in, click a card whose briefing contains a table and
   a fenced block: the answer arrives keyed to the stripped question, and the
   briefing does not swallow the click.
9. Keyboard: `1`–`4` selects the nth card, matching a click — a single-select
   card pressed twice stays selected, a `multiSelect` one toggles off. `5` does
   nothing. Typing a digit into "Something else" reaches the field and selects
   no card. With two questions, the digit lands in whichever holds focus, and
   with nothing focused, in the one nearest the top.
10. `Cmd+Enter` sends only once every question is answered; `Escape` hands back.
   Clicking Send posts with no native confirmation in between.
11. With three questions the footer names the first unanswered one and scrolls to
   it on click, then disappears once all three are answered. A heading
   containing `<img src=x onerror=alert(1)>` renders there as literal text.
12. The countdown is absent until the last minute, then counts down to the
   unchanged `Expired — answer in the terminal.`
13. The scheme toggle flips the whole page, and a briefing diagram flips with
   it rather than keeping its load-time colors. Check that a second click
   returns to the first scheme and leaves one SVG per fence, not two.
14. A briefing carrying a ```` ```mermaid ```` fence draws the diagram, themed to
   the page — check it in both light and dark, since the theme is read off the
   custom properties at load and not re-read on a scheme change. A second fence
   with deliberately broken syntax stays on screen as its own source with no
   error card. A question with no fence must not request `/mermaid.min.js` at
   all: 3.4MB is the cost of getting that gate wrong. Then delete
   `vendor/mermaid.min.js` and ask again — the diagram degrades to source and
   the cards still answer.

Suites stub `cmux`, so a real launch is still worth one by-hand check: run
`openUrl` against a temp file from a cmux session and confirm `cmux identify`
reports a focused `browser` surface. A disabled embedded browser
(`cmux disable-browser`) still exits 0, so only `cmux browser status` detects it,
and each call stacks a new browser surface rather than reusing one.

`${CLAUDE_PLUGIN_ROOT}` changes on every plugin update. Never write state there.
