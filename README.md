# cc-visualq

Claude Code asks multiple-choice questions through `AskUserQuestion`, and the
dialog is terminal-only — plain text options, no charts. When the options differ
along numbers you care about (bundle size, latency, risk, weeks of work), text
makes you hold the comparison in your head.

This plugin renders those options as an HTML comparison chart in your
terminal's embedded browser, and you answer by clicking a card. If no browser
appears, the terminal dialog asks as it always would.

## Install

```
/plugin marketplace add underw8/cc-visualq
/plugin install cc-visualq@cc-visualq
```

Requires Node (any version with `node` on PATH). No npm dependencies.

## Usage

Nothing to configure. When Claude includes a metric tag in an option's
description, the chart appears:

```
{label: "Svelte", description: "Smallest output. {bundle_kb:12, cold_start_ms:38}"}
```

The `{key:value, ...}` tag is stripped before the dialog renders, so the
terminal still shows a clean description. Options without a tag get no chart and
no browser — the question behaves exactly as it would without the plugin.

A `SessionStart` hook injects an option-authoring rule (`hooks/askq-rule.md`)
into every session, so Claude tags options with measurable dimensions on its
own — there's nothing to add to your own `CLAUDE.md`.

## How it works

A `PreToolUse` hook on `AskUserQuestion` serves the options as an HTML
comparison over loopback, blocks until a card is clicked, and answers the tool
directly. Every path that isn't an explicit click emits nothing, which renders
no decision and lets the terminal dialog ask unchanged.

```mermaid
sequenceDiagram
    autonumber
    participant CC as Claude Code
    participant H as hooks/askq.js
    participant R as lib/render.js
    participant L as lib/launch.js
    participant B as embedded browser

    Note over CC: SessionStart injected askq-rule.md,<br/>so options carry metric tags and briefings
    CC->>H: PreToolUse AskUserQuestion, tool_input on stdin
    H->>H: stripTags: split briefing, parse metric tag
    alt no metric tag and no briefing
        H-->>CC: exit 0, no output
        Note over CC: terminal dialog asks unchanged
    else something to draw
        H->>H: mint nonce
        H->>R: renderPage
        R-->>H: HTML
        H->>H: listen 127.0.0.1:0
        H->>L: openUrl
        alt no launcher succeeded
            H-->>CC: exit 0, no output
        else launched
            B->>H: GET / with nonce
            Note over H: arrived = true
            B->>H: GET /ping every 3s
            B->>H: POST /answer with nonce, picked, other, notes
            H->>H: timing-safe nonce compare
            H->>H: filter labels against the tool's own set
            H-->>CC: allow + updatedInput.answers
        end
    end
```

Three ways the hook stops waiting without an answer: `ARRIVE_MS` 10s with
nothing fetching the page, `WAIT_MS` 240s with nothing posting, or a rejected
POST giving up. `WAIT_MS` stays below the hook entry's `timeout: 300` so the
process exits on its own terms instead of being killed mid-write.

### Modules

```mermaid
flowchart TD
    HJ["hooks/askq.js<br/>server, routes, decision"]
    ME["lib/metrics.js<br/>tag parsing, units, bar widths"]
    RE["lib/render.js<br/>page shell, cards, styles"]
    CH["lib/charts.js<br/>the three forms, form selection"]
    MD["lib/md.js<br/>briefing markdown subset"]
    PS["lib/page-script.js<br/>the browser script"]
    ES["lib/esc.js<br/>HTML escaping"]
    LA["lib/launch.js<br/>launcher order and spawn"]
    VS["lib/vscode.js<br/>stub file + settings"]
    VE["vendor/mermaid.min.js<br/>served on demand"]

    HJ --> ME
    HJ --> RE
    HJ --> LA
    HJ -.->|"GET /mermaid.min.js"| VE
    RE --> ME
    RE --> CH
    RE --> MD
    RE --> PS
    RE --> ES
    CH --> ME
    CH --> ES
    MD --> ES
    LA --> VS
```

Markup has three owners: `render.js` the page shell and the cards, `charts.js`
chart bodies, `md.js` briefing bodies. All three escape through the one
`esc.js`, which is its own module because `charts.js` and `render.js` both need
it and neither may require the other. Option labels and briefings are
model-generated and reach a browser, so everything interpolated into HTML goes
through it. `page-script.js` is not a fourth owner — it emits the browser
script, not markup.

### Reading the metrics

```mermaid
flowchart LR
    RAW["option description"] --> SB["splitBrief<br/>on the brief sentinel"]
    SB --> BRIEF["briefing markdown"]
    SB --> REST["remainder"]
    REST --> PM["parseMetrics<br/>tag anchored at end"]
    PM --> CLEAN["clean description"]
    PM --> CHART["chart key<br/>first declaration wins"]
    PM --> METRICS["metrics"]
    METRICS --> RD["resolveDimensions<br/>per key, across options"]
    RD --> SC["scalesFor<br/>per-key maxima"]
    SC --> BP["barPercent"]
```

`splitBrief` runs first, so a briefing ending in a code sample like
`{ retries: 3 }` is not read as the metric tag and lost. `resolveDimensions`
scans every option's value under one key before scaling: `m` is minutes in a
duration and millions in a count, so `{stars:2m}` beside `{stars:500k}` reads
as millions, and without that scan it would draw a bar 240x too long.

The metric tag is the only way data reaches a chart. Every renderer takes
`[{label, metrics}]` and nothing else, so a `chart:` fence in a briefing would
need no renderer changes — but a tag is bound to the choice, and a fence would
make the page a chart of data rather than a comparison of options.

## The metric tag

End an option's description with `{key: value, ...}` and the page draws a
comparison. Values may be numbers with units (`$12/mo`, `40ms`, `4mb`, `80%`,
`1,200`) or ordinals (`none`, `minimal`, `low`, `medium`, `high`, `critical`).
Units are normalized per key, so `4mb` outranks `12kb`.

The reserved `chart` key picks the form, declared on the first option:

| `chart:` | Shows | Needs |
|---|---|---|
| `bars` (default) | one bar per metric, inside each option card | nothing |
| `grouped` | one block per metric, options side by side | ≥1 metric |
| `matrix` | options as rows, metrics as columns, exact values | ≥1 metric |

A form whose data can't carry it degrades quietly rather than drawing an empty
frame: `grouped` and `matrix` fall back to `bars` when no option carries a
metric at all.

Every form prints each value as text beside its bar, so a key one option has no
value for reads as an em dash rather than as a mark at zero. Axis-per-key forms
— radar, scatter — were dropped for exactly that: a vertex at the centre and a
missing vertex look identical, and `AskUserQuestion` caps a question at four
options, so the largest possible dataset is sixteen numbers, which a table
states outright.

Bars scale **per key**: each metric's largest value across the options is full
width, so `bundle` and `latency` never share a scale.

Values are normalized before comparison, so mixed units rank correctly:

| value | reads as |
|---|---|
| `4mb`, `12kb`, `1gb` | bytes (binary; `4mb` outranks `12kb`) |
| `250ms`, `1.5s`, `30m`, `2h` | duration |
| `$4.2k`, `$1,200`, `1,234,567` | number; currency and separators ignored |
| `$12/mo`, `120kb/s` | the `/period` is dropped, the magnitude ranks |
| `2m` stars / `30m` build | millions or minutes, from the other values under that key |
| `80%` | percent |
| `low`, `medium`, `high`, `critical` | ordinal scale, drawn proportionally |
| `bananas` | text, shown without a bar |

Ordinal words are a fixed vocabulary: `none`, `minimal`, `low`, `medium`,
`high`, `critical` — the same six the session rule tells Claude to use. Anything
outside it renders as plain text rather than being guessed at.

A key whose values mix dimensions (one `4mb`, one `2s`) falls back to ranking the
raw numbers, since no shared scale exists.

## Briefings

A metric tag compares options. A briefing says what the reader needs to know
before comparing them. Everything after `<!--brief-->` is markdown, drawn on
the page and stripped from the terminal dialog:

    Which caching layer?
    <!--brief-->
    p99 is dominated by renders, not queries.

    | stage | p50 | p99 |
    |---|---|---|
    | render | 88ms | 710ms |

### Pros and cons

A bullet run containing at least one `+` renders as a trade-off list — `+`
items with a green plus, `-` items with a red minus — which on an option
briefing puts the qualitative case beside the numbers:

    Bun
    Fastest cold start. {chart: matrix, cold:12ms, rss:34mb}
    <!--brief-->
    + Bundler and test runner built in
    - Native addon gaps still bite

A run of `-` alone stays an ordinary bullet list, so ordinary briefing lists are
unaffected; one `+` anywhere in the run is what asks for the treatment. The
glyph carries the meaning and the color only reinforces it — red and green
collapse under deuteranopia, `+` and `−` do not — and both hues are checked
above 4.5:1 on the card surface in either scheme.

A question briefing opens on the problem — what is being decided, why it comes
up now, what goes wrong if it goes the wrong way — written for someone who has
read none of the conversation. Its
first paragraph is set larger than the detail beneath it. On a question it draws
above the comparison; on an option's description it draws inside that card,
below the bars. Both are page-only — the dialog shows
the text before the sentinel, so a question stays one clean line.

The briefing goes last, after the metric tag. A briefing ending in braces would
otherwise be read as the tag.

Supported: paragraphs, one level of `-` or `1.` lists, `+`/`-` trade-off lists,
pipe tables with a separator row, fenced code, a ```` ```mermaid ```` diagram,
`**strong**`, `*em*`, `` `code` ``, and headings. Links and images render as literal text —
nothing authored becomes a tag, and the page never navigates away while a
question is waiting.

A ```` ```mermaid ```` fence is drawn as a diagram, themed off the page's own
colors so it follows light and dark. The session rule tells Claude to reach for
one whenever the explanation is a shape — a flow, a sequence, a dependency —
rather than describing it in prose. The library is committed under `vendor/`
and served from the hook, so nothing is fetched from a CDN and no part of the
diagram leaves the machine. It loads only for a page that actually holds one.
A diagram mermaid cannot parse renders as its own source rather than an error
card, so a mistyped fence costs a code block and nothing else.

A question carrying only a briefing and no metrics still opens a page.

## Light and dark

The page follows the OS, and a button at the top right switches it for the one
page. That button exists because the embedded browser does not always agree with
its host: VS Code's browser follows Chromium and the OS, not your editor theme,
so a dark editor on a light OS otherwise renders a light page inside it.

`prefers-color-scheme` cannot be overridden from CSS, so every two-scheme token
is a `light-dark()` pair and the button writes `color-scheme` on the root. A
browser without `light-dark()` keeps the light theme and the button stays
hidden. A briefing diagram is redrawn on switch, since mermaid bakes colors into
its SVG and cannot read a custom property. Nothing is persisted: the port
changes with every question, so there is no origin to remember it against.

## Browser selection

The launcher tries each target and takes the first that reports success, rather
than reading `TERM_PROGRAM` — that variable lies in practice (a cmux window
running a Ghostty profile reports `iTerm.app`, and a session under the VS Code
extension host reports `ghostty` while inside both).

Inside cmux the page opens in a browser split. Everywhere else it goes to your
default browser.

Under VS Code the page opens in the integrated browser, with nothing to
configure. `code` cannot be handed a URL, so the hook writes a stub file that
renders and navigates itself to the page, along with the editor association that
makes VS Code open it in the browser rather than as text. Both are removed
afterwards, and a `.vscode/settings.json` of your own is restored byte for byte
— unless it contains comments, which cannot survive a JSON round trip, in which
case the launcher declines and leaves it alone.

VS Code only renders files under a folder it trusts, so when the project
directory is not the folder VS Code has open the page reads `Forbidden` rather
than showing the chart.

iTerm2 has an embedded browser too, but nothing outside it can open a URL there
until 3.7 ships, at which point `open` reaches it anyway.

Order: `cmux` → `vscode` → `open` (macOS) → `xdg-open` (Linux). Each is skipped
unless its host is detected: `cmux` needs `CMUX_SOCKET_CAPABILITY`, `vscode`
needs `VSCODE_PID`, and both need their binary on `PATH`.

cmux comes first because it opens a split without writing anything; when it is
not there, or fails, the VS Code launcher gets its turn.

Override it entirely:

```sh
export CC_VISUALQ_OPEN="firefox --private-window"
```

## Tests

```
./test/run-all.sh
```

No framework, no npm dependencies: `node` and `bash` only, plus the `claude`
CLI for `test-install.sh`. `test-load.js` runs first and only checks that every
module parses, so a syntax error is reported against its own file rather than as
a puzzling failure in a later suite. `make check` runs every suite plus manifest
validation; each `test/test-*` file also runs standalone.

## License

Apache-2.0
