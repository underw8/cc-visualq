## Authoring AskUserQuestion options

When options differ on measurable dimensions, end each description with a
metric tag: `{chart: grouped, cost: $12/mo, setup: 2h, risk: low}`

- Same keys, same units, on every option of the question. 2-4 keys.
- Values: number + unit — `$` `%`, time `ms s min h`, size `kb mb gb`,
  count `k m b` — or an ordinal none/minimal/low/medium/high/critical.
  No comma inside a value. `m` and `b` read as minutes/bytes or
  millions/billions from the other values under the same key, so keep one
  dimension per key.
- `chart` picks the form, on the first option only:
  grouped (magnitudes side by side, any dims) · matrix (exact values in a
  table) · scatter (two dims traded off) · radar (3+ dims, ≤4 options,
  whole-profile shape) · bars (default, per-option).
- Tag every option of a question, or none of them. `scatter` needs every
  option to carry both its axes and quietly falls back when one doesn't.
- Name a form whenever two or more keys are shared. The default `bars` draws
  no comparison at all, only a row per option.
- The description before the tag states what you give up by picking it,
  not a restatement of the label. One to three sentences.
- Options with no measurable difference: no tag on any of them.

## Briefings

Everything after `<!--brief-->` is markdown drawn on the comparison page and
stripped from the terminal dialog. Write one on the question whenever the
reader did not watch the work that led here — which is most of the time. Skip
it only when the labels alone settle the choice.

- Open on the problem, not the history: what is being decided, why it comes up
  now, what goes wrong if it goes the wrong way. Two or three sentences, for
  someone who has read none of the conversation.
- Then only what the cards cannot carry: the constraint that rules options out,
  the measurement behind the numbers, the part of the design that forces the
  choice. Up to ~15 lines.
- On an option: the consequence of picking that one — what it costs later, what
  it forecloses. Not a longer description. Up to ~6 lines.
- Cut whatever the reader would guess unaided: the labels, the obvious upside,
  a metric already in the tag.
- The briefing goes last, after the metric tag.
- Available: paragraphs, one level of `-` or `1.` lists, pipe tables with a
  `|---|` separator row, fenced code, a ```` ```mermaid ```` fence, `**strong**`,
  `*em*`, `` `code` ``, headings `#` to `####`. Links and images render as
  literal text.
- A diagram only when the thing being decided *is* a shape — a flow, a
  dependency, a sequence. Never a diagram of the options; that is what the
  comparison above it already draws. Mistyped mermaid renders as its own
  source, so a diagram you are unsure of costs the reader a code block.
- A briefing that restates the options is worse than none.
