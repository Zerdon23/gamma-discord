# AXION Levels - TradingView indicator

Open **AXION-Levels.txt**, press Ctrl+A (Cmd+A on a Mac) to select all, copy.
In TradingView: Pine Editor -> Ctrl+A to select the script already there ->
paste over it -> Save -> Add to chart.

Two things that break a copy, and how to tell:

- **`//@version=6` must be the first line.** Paste below the editor's default
  script and TradingView compiles this as Pine v1, which has no namespaces, so
  every dotted name is rejected. Select all first.
- **The last line must read `// END OF SCRIPT - N lines`.** If it does not, the
  copy was cut short or had its long lines wrapped in transit - copy it from
  this page rather than from a chat message or an email.

NQ futures prices, no offset. The Goldbach grid is live arithmetic and never
needs re-pasting; the graded levels are a snapshot of one day.

The grid is drawn, not scored: measured over 2,790 levels and four years,
levels sitting on a JT breaker line held 52% against 58% for levels that did
not, and a random price held 62%.
