## Authoring AskUserQuestion options

When options differ on measurable dimensions, end each description with a
metric tag: `{chart: grouped, cost: $12/mo, setup: 2h, risk: low}`

- Same keys, same units, on every option of the question. 2-4 keys.
- Values: number + unit ($ % ms s h mb k) or an ordinal
  none/minimal/low/medium/high/critical. No comma inside a value.
- `chart` picks the form, on the first option only:
  grouped (magnitudes side by side, any dims) · matrix (exact values in a
  table) · scatter (two dims traded off) · radar (3+ dims, ≤4 options,
  whole-profile shape) · bars (default, per-option).
- Tag every option of a question, or none of them. `scatter` needs every
  option to carry both its axes and quietly falls back when one doesn't.
- The description before the tag states what you give up by picking it,
  not a restatement of the label. One to three sentences.
- Options with no measurable difference: no tag on any of them.

## Briefings

When the choice needs context the reader does not hold, append a briefing.
Everything after `<!--brief-->` is markdown drawn on the comparison page and
stripped from the terminal dialog.

- On the question: open with a TL;DR — two or three sentences on where the work
  got to and what this decision settles, written for someone who has not read
  the conversation. Then whatever they need to choose: the current design, the
  numbers, the constraint. Drawn above the comparison, up to ~15 lines.
- On an option: what that one choice buys or costs. Up to ~6 lines.
- The briefing goes last, after the metric tag.
- Available: paragraphs, one level of `-` or `1.` lists, pipe tables with a
  `|---|` separator row, fenced code, `**strong**`, `*em*`, `` `code` ``,
  headings `#` to `####`. Links and images render as literal text.
- A briefing that restates the options is worse than none.
