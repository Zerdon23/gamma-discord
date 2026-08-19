# Goldbach + Gamma TradingView Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a complete TradingView Pine v6 indicator every weekday morning — Goldbach dealing-range grid computed live, plus that day's dealer-gamma levels written in — and post it to a friends' Discord server with the existing crew bot.

**Architecture:** Two new pure CommonJS modules in the existing `gamma-discord` cloud repo. `goldbach.js` is arithmetic with no I/O. `pine.js` reads the `levels/latest.json` that `build-levels.js` already writes each morning and emits the finished script text. The morning workflow writes and commits the file; `friends-update.js` attaches it to the Discord post. Nothing touches the CBOE fetch, the basis measurement, or the DeepCharts annotation path.

**Tech Stack:** Node 20, zero npm dependencies, `node:test` + `node:assert`. Output is TradingView Pine Script v6 (text).

**Spec:** `docs/superpowers/specs/2026-08-19-goldbach-gamma-pine-design.md`

## Global Constraints

- **Zero dependencies.** Node built-ins only. This repo has no `package.json` dependency tree and must not grow one.
- **CommonJS.** `require` / `module.exports`, matching every existing module.
- **Tests run as `node --test`** from the repo root, with no path argument (a directory argument fails on Node 24 by resolving `tests/` as a module).
- **Generated Pine must be ASCII-only.** A non-ASCII character pasted through a chat client is what mangles these scripts. Enforced by a test.
- **Pine version is exactly `//@version=6`.**
- **No price offset may be applied to gamma prices.** `levels/latest.json` already carries NQ prices; the NDX-to-NQ basis is applied upstream in `build-levels.js`. Adding it again moves every wall by hundreds of points.
- **Goldbach fractions, codes and colours are copied verbatim** from `../amd-goldbach-quantower/AmdGoldbach.cs` and must not be "tidied".
- **Gamma colours are copied verbatim** from this repo's `annotations.js`, so a friend's TradingView chart matches Brandon's DeepCharts chart.
- **Never `git add -A`** in this repo. Other sessions have had uncommitted work swept into commits here. Stage named files only.

---

### Task 1: `goldbach.js` — the dealing-range arithmetic

**Files:**
- Create: `goldbach.js`
- Test: `tests/goldbach.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TABLE` — array of `{ frac: number, code: string, name: string, grp: string }`, 17 entries, ordered low to high.
  - `COLORS` — object mapping group name to `[r, g, b]`.
  - `PO3_SIZES` — `[27, 81, 243, 729, 2187, 6561]`.
  - `range(price, po3 = 729, shift = 0)` → `{ low: number, high: number, po3: number }`
  - `levels(rng, opts = { ext: true })` → array of `{ frac, code, name, grp, price }`
  - `ce(drawnLevels)` → array of `{ price, lower, upper }`, midpoints between consecutive entries
  - `at(price, rng)` → `{ outside: 'below' | 'above' | null, code: string | null, frac: number | null }`
  - `autoPo3(price)` → number from `PO3_SIZES`
  - `fracLabel(frac)` → string, C# `"0.###"` formatting

- [ ] **Step 1: Write the failing test**

Create `tests/goldbach.test.js`:

```js
/*
 * The Goldbach grid.
 *
 * The 729 numbers below are not invented. They were read off dmn's own
 * "DRs/Algo" stats box in the indicator video (2026-07-20) and reproduced
 * exactly by this arithmetic:
 *
 *   floor(30100 / 729) * 729 = 29889   and   29889 + 729 = 30618
 *
 * The 243 and 81 rows are the same arithmetic at other scales and are asserted
 * for self-consistency: every scale's high must be its own low plus its block.
 */
const test = require('node:test');
const assert = require('node:assert');
const G = require('../goldbach.js');

test('the 729 range matches the published stats box', () => {
  const r = G.range(30100, 729);
  assert.strictEqual(r.low, 29889);
  assert.strictEqual(r.high, 30618);
});

test('smaller scales bracket the same price', () => {
  assert.deepStrictEqual(
    { low: G.range(30100, 243).low, high: G.range(30100, 243).high },
    { low: 29889, high: 30132 },
  );
  assert.deepStrictEqual(
    { low: G.range(30100, 81).low, high: G.range(30100, 81).high },
    { low: 30051, high: 30132 },
  );
});

test('a price exactly on a boundary belongs to the range above', () => {
  const r = G.range(29889, 729);
  assert.strictEqual(r.low, 29889);
});

test('shift moves the range by whole blocks', () => {
  assert.strictEqual(G.range(30100, 729, 1).low, 29889 + 729);
  assert.strictEqual(G.range(30100, 729, -1).low, 29889 - 729);
});

test('equilibrium sits at the midpoint', () => {
  const eq = G.levels(G.range(30100, 729)).find((l) => l.code === 'EQ');
  assert.strictEqual(eq.price, 30253.5);
});

test('there are 17 levels with extensions and 15 without', () => {
  assert.strictEqual(G.levels(G.range(30100, 729), { ext: true }).length, 17);
  assert.strictEqual(G.levels(G.range(30100, 729), { ext: false }).length, 15);
});

test('interior arrays mirror about equilibrium, the extremes do NOT', () => {
  // 0.03/0.97 are both RB, 0.11/0.89 both OB, and so on. But 0 is "Low" and
  // 1 is "High" - they are named for their side. A mirror test that asserts
  // otherwise is wrong; that was got backwards once already.
  const by = new Map(G.TABLE.map((t) => [t.frac, t.code]));
  for (const f of [0.03, 0.11, 0.17, 0.29, 0.41, 0.47]) {
    assert.strictEqual(by.get(f), by.get(Number((1 - f).toFixed(3))), `${f} should mirror`);
  }
  assert.notStrictEqual(by.get(0), by.get(1));
});

test('CE midpoints sit between consecutive drawn levels, so extensions change the set', () => {
  const withExt = G.ce(G.levels(G.range(30100, 729), { ext: true }));
  const without = G.ce(G.levels(G.range(30100, 729), { ext: false }));
  assert.strictEqual(withExt.length, 16);
  assert.strictEqual(without.length, 14);
  const first = G.levels(G.range(30100, 729), { ext: false }).slice(0, 2);
  assert.strictEqual(without[0].price, (first[0].price + first[1].price) / 2);
});

test('at() says out-of-range rather than naming the nearest edge', () => {
  const r = G.range(30100, 729);
  assert.strictEqual(G.at(r.low - 500, r).outside, 'below');
  assert.strictEqual(G.at(r.low - 500, r).code, null);
  assert.strictEqual(G.at(r.high + 500, r).outside, 'above');
  assert.strictEqual(G.at(30253.5, r).outside, null);
  assert.strictEqual(G.at(30253.5, r).code, 'EQ');
});

test('autoPo3 picks a block worth a few percent of price', () => {
  assert.strictEqual(G.autoPo3(29700), 729);   // NQ
  assert.strictEqual(G.autoPo3(7400), 243);    // ES
  assert.strictEqual(G.autoPo3(680), 27);      // SPY
});

test('fracLabel drops trailing zeros like the C# "0.###"', () => {
  assert.strictEqual(G.fracLabel(0.5), '0.5');
  assert.strictEqual(G.fracLabel(0), '0');
  assert.strictEqual(G.fracLabel(1), '1');
  assert.strictEqual(G.fracLabel(0.03), '0.03');
  assert.strictEqual(G.fracLabel(-0.111), '-0.111');
  assert.strictEqual(G.fracLabel(1.111), '1.111');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: FAIL — `Cannot find module '../goldbach.js'`

- [ ] **Step 3: Write the implementation**

Create `goldbach.js`:

```js
/*
 * The Goldbach dealing range.
 *
 * Ported verbatim from ../amd-goldbach-quantower/AmdGoldbach.cs so the two
 * cannot drift. That indicator was itself matched against dmn's published
 * "DRs/Algo" stats box: floor(30100/729)*729 = 29889, +729 = 30618.
 *
 * There is no data here. The range is floor(price / PO3) * PO3, and every
 * level is a fixed fraction of it - which is the whole reason this can live
 * inside a text file someone pastes into TradingView. It cannot go stale.
 *
 * Two things that look like details and are not:
 *
 *   - The interior arrays mirror about equilibrium (0.03 and 0.97 are both
 *     Rejection Blocks) but 0 and 1 do NOT - they are named Low and High for
 *     their own side.
 *   - 0.618 and 1.272 are FIBONACCI, not Goldbach. They are deliberately
 *     absent. Anything that presents them as PD arrays is wrong.
 */

// group -> colour, matching the C# InputParameter defaults exactly.
const COLORS = {
  Ext: [224, 90, 90],     // 0 / 1 range extremes
  Ext2: [90, 150, 255],   // -0.111 / 1.111 extensions
  Eq: [240, 200, 90],     // 0.5 equilibrium
  Rb: [224, 110, 110],    // rejection block
  Ob: [74, 158, 255],     // order block
  Fvg: [90, 200, 215],    // fair value gap
  Lv: [180, 140, 255],    // liquidity void
  Br: [232, 176, 72],     // breaker
  Mb: [200, 150, 110],    // mitigation block
  Ce: [120, 130, 145],    // consequent encroachment midpoints
};

const TABLE = [
  { frac: -0.111, code: 'Ext', name: 'Extension (low)', grp: 'Ext2' },
  { frac: 0.0, code: 'Low', name: 'Range Low', grp: 'Ext' },
  { frac: 0.03, code: 'RB', name: 'Rejection Block', grp: 'Rb' },
  { frac: 0.11, code: 'OB', name: 'Order Block', grp: 'Ob' },
  { frac: 0.17, code: 'FVG', name: 'Fair Value Gap', grp: 'Fvg' },
  { frac: 0.29, code: 'LV', name: 'Liquidity Void', grp: 'Lv' },
  { frac: 0.41, code: 'BR', name: 'Breaker', grp: 'Br' },
  { frac: 0.47, code: 'MB', name: 'Mitigation Block', grp: 'Mb' },
  { frac: 0.5, code: 'EQ', name: 'Equilibrium', grp: 'Eq' },
  { frac: 0.53, code: 'MB', name: 'Mitigation Block', grp: 'Mb' },
  { frac: 0.59, code: 'BR', name: 'Breaker', grp: 'Br' },
  { frac: 0.71, code: 'LV', name: 'Liquidity Void', grp: 'Lv' },
  { frac: 0.83, code: 'FVG', name: 'Fair Value Gap', grp: 'Fvg' },
  { frac: 0.89, code: 'OB', name: 'Order Block', grp: 'Ob' },
  { frac: 0.97, code: 'RB', name: 'Rejection Block', grp: 'Rb' },
  { frac: 1.0, code: 'High', name: 'Range High', grp: 'Ext' },
  { frac: 1.111, code: 'Ext', name: 'Extension (high)', grp: 'Ext2' },
];

const PO3_SIZES = [27, 81, 243, 729, 2187, 6561];

const round2 = (n) => Math.round(n * 100) / 100;

/** floor(price / po3) * po3, then shifted by whole blocks. */
function range(price, po3 = 729, shift = 0) {
  const low = Math.floor(price / po3) * po3 + shift * po3;
  return { low, high: low + po3, po3 };
}

/** The table priced into a range. `ext` drops the two extension rows. */
function levels(rng, opts = {}) {
  const ext = opts.ext !== false;
  const span = rng.high - rng.low;
  return TABLE
    .filter((t) => ext || (t.frac >= 0 && t.frac <= 1))
    .map((t) => ({ ...t, price: round2(rng.low + t.frac * span) }));
}

/*
 * Consequent encroachment: the midpoint between consecutive DRAWN levels.
 * Deriving it from a fixed list instead would silently disagree with the
 * Quantower indicator the moment the extensions are toggled off.
 */
function ce(drawn) {
  const out = [];
  for (let i = 0; i < drawn.length - 1; i += 1) {
    const lower = drawn[i];
    const upper = drawn[i + 1];
    out.push({ price: round2((lower.price + upper.price) / 2), lower, upper });
  }
  return out;
}

/*
 * Where does this price sit? Outside the range it says so - it does NOT name
 * the nearest edge. Reporting "on the Low" while price is 1,700 points beneath
 * the range is an unknown state rendering as a confident claim, and it shipped
 * once in the desktop app before being caught.
 */
function at(price, rng) {
  if (price < rng.low) return { outside: 'below', code: null, frac: null };
  if (price > rng.high) return { outside: 'above', code: null, frac: null };
  const span = rng.high - rng.low;
  const f = (price - rng.low) / span;
  let best = null;
  let bestd = Infinity;
  for (const t of TABLE) {
    if (t.frac < 0 || t.frac > 1) continue;
    const d = Math.abs(t.frac - f);
    if (d < bestd) { bestd = d; best = t; }
  }
  return { outside: null, code: best.code, frac: best.frac };
}

/*
 * Pick a block worth roughly 3% of price, so the grid is usable on a symbol
 * whose scale nobody thought about. 729 on NQ is 2.5%; on SPY it would be more
 * than the whole chart.
 */
function autoPo3(price) {
  let best = 729;
  let bestd = Infinity;
  for (const s of PO3_SIZES) {
    const d = Math.abs(s / price - 0.03);
    if (d < bestd) { bestd = d; best = s; }
  }
  return best;
}

/** C# "0.###" - "0.5" and never "0.500". */
const fracLabel = (f) => String(Number(f.toFixed(3)));

module.exports = { TABLE, COLORS, PO3_SIZES, range, levels, ce, at, autoPo3, fracLabel };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: all `goldbach.test.js` tests PASS, and every pre-existing test still passes.

- [ ] **Step 5: Mutation-test the two guards that matter**

Temporarily change `at()` so the `price < rng.low` branch returns the Low row instead of `outside: 'below'`. Run `node --test`. Expected: the `at() says out-of-range` test FAILS. Restore it and re-run to green.

Then temporarily add `0.618` to `TABLE`. Run `node --test`. Expected: the level-count test FAILS. Restore and re-run to green.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
git add goldbach.js tests/goldbach.test.js
git commit -m "The Goldbach dealing range, ported from the Quantower indicator"
```

---

### Task 2: `pine.js` — generate the indicator text

**Files:**
- Create: `pine.js`
- Test: `tests/pine.test.js`
- Test fixture: `tests/fixtures/latest-sample.json`

**Interfaces:**
- Consumes: `goldbach.js` (`TABLE`, `COLORS`, `fracLabel`), and a parsed `levels/latest.json` object shaped `{ builtAt, symbol, basis, basisSource, nqSpot, regime, note, levels: [{ type, price, label }] }`.
- Produces: `build(meta, opts = {})` → string (the complete Pine script). Throws if `meta` has no `levels` or no `builtAt`.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/latest-sample.json` — a trimmed copy of a real build, so the test asserts against the shape the pipeline actually writes rather than one I imagined:

```json
{
  "builtAt": "2026-08-19T12:30:04.001Z",
  "symbol": "NQ",
  "basis": 96,
  "basisSource": "measured",
  "indexSpot": 29614.0,
  "nqSpot": 29710.0,
  "regime": "positive",
  "netGex": 2399201019.37,
  "source": "CBOE delayed chain (_NDX) + Yahoo NQ=F",
  "note": "Context and targets, not triggers. Walls are open-interest based and rebuild overnight.",
  "levels": [
    { "type": "CALL_WALL", "price": 29900, "label": "CALL WALL 29,900" },
    { "type": "PUT_WALL", "price": 29300, "label": "PUT WALL 29,300" },
    { "type": "FLIP", "price": 29450.76, "label": "GAMMA FLIP 29,451" },
    { "type": "GAMMA_POS", "price": 30000, "label": "+GAMMA 30,000 - 503m" },
    { "type": "GAMMA_NEG", "price": 28800, "label": "-GAMMA 28,800 - 276m" },
    { "type": "PDH", "price": 30287.5, "label": "PRIOR DAY HIGH 30,288" },
    { "type": "PDL", "price": 30066.5, "label": "PRIOR DAY LOW 30,067" },
    { "type": "ONH", "price": 30121.25, "label": "OVERNIGHT HIGH 30,121" },
    { "type": "ONL", "price": 29680.5, "label": "OVERNIGHT LOW 29,681" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/pine.test.js`:

```js
/*
 * The generated indicator.
 *
 * These tests read the text that gets pasted into TradingView. Pine does not
 * compile on this machine, so they check everything a compiler would not:
 * that the day's numbers are present, that nothing non-ASCII can be mangled by
 * a chat client, that the drawing caps are declared, and above all that the
 * gamma prices are written through UNCHANGED - latest.json is already in NQ
 * prices, and applying the basis a second time would move every wall by
 * hundreds of points while still looking entirely plausible.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../pine.js');

const meta = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'latest-sample.json'), 'utf8'),
);

test('it is a version 6 indicator with the drawing caps declared', () => {
  const src = P.build(meta);
  assert.ok(src.startsWith('//@version=6'), 'must open with the version line');
  assert.match(src, /max_lines_count\s*=\s*\d+/);
  assert.match(src, /max_labels_count\s*=\s*\d+/);
});

test('ASCII only - a chat client must not be able to mangle it', () => {
  // eslint-disable-next-line no-control-regex
  const bad = P.build(meta).match(/[^\x09\x0a\x0d\x20-\x7e]/g);
  assert.strictEqual(bad, null, `non-ASCII found: ${JSON.stringify(bad)}`);
});

test('every gamma price is written through unchanged', () => {
  const src = P.build(meta);
  for (const lv of meta.levels) {
    assert.ok(src.includes(String(lv.price)), `missing price ${lv.price}`);
  }
});

test('no basis is applied to the gamma prices', () => {
  // The wall is 29900 and the basis is 96. If anyone ever "helpfully" adds the
  // basis, 29996 appears and this fails.
  const src = P.build(meta);
  assert.ok(src.includes('29900'), 'the wall itself must be present');
  assert.ok(!src.includes('29996'), 'the basis must NOT be added a second time');
});

test('every Goldbach fraction and PD code reaches the script', () => {
  const src = P.build(meta);
  const G = require('../goldbach.js');
  for (const t of G.TABLE) {
    assert.ok(src.includes(G.fracLabel(t.frac)), `missing fraction ${t.frac}`);
  }
  for (const code of ['RB', 'OB', 'FVG', 'LV', 'BR', 'MB', 'EQ']) {
    assert.ok(src.includes(`"${code}"`), `missing PD code ${code}`);
  }
});

test('the build date is stamped where a reader will see it', () => {
  const src = P.build(meta);
  assert.ok(src.includes('2026-08-19'), 'the build date must appear');
  assert.match(src, /rebuild overnight/i, 'and say the walls are one session old');
});

test('it guards the symbol, because these prices are NQ prices', () => {
  const src = P.build(meta);
  assert.match(src, /syminfo\.ticker/);
  assert.match(src, /str\.contains/);
});

test('a build with no levels is refused rather than emitted empty', () => {
  assert.throws(() => P.build({ builtAt: meta.builtAt, levels: [] }), /no levels/i);
  assert.throws(() => P.build({ levels: meta.levels }), /builtAt/i);
});

test('labels carry the fraction, the code and the price', () => {
  const src = P.build(meta);
  assert.match(src, /0\.5/);
  assert.ok(src.includes('"EQ"'));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: FAIL — `Cannot find module '../pine.js'`

- [ ] **Step 4: Write the implementation**

Create `pine.js`:

```js
/*
 * levels/latest.json -> a complete TradingView indicator.
 *
 * Two halves, built differently on purpose:
 *
 *   Goldbach is emitted as ARITHMETIC. floor(price / PO3) * PO3 is evaluated on
 *   the viewer's chart, so the grid re-derives itself as price moves into a new
 *   block. An old copy of this file still draws a correct grid.
 *
 *   Gamma is emitted as CONSTANTS, because Pine cannot fetch anything. The
 *   walls are open-interest based and rebuild overnight, so today's numbers are
 *   right for one session and wrong after that. Hence the build stamp.
 *
 * The prices in latest.json are ALREADY NQ prices - build-levels.js applies the
 * NDX->NQ basis and refuses to publish when that basis is stale. Nothing here
 * adjusts them. A test pins that.
 *
 * ASCII only. A non-ASCII character survives here and gets mangled the moment
 * the file passes through a chat client, which is how a script that "looks
 * fine" fails to compile on someone else's screen.
 */
const G = require('./goldbach.js');

// Gamma colours copied from annotations.js so a friend's TradingView chart and
// Brandon's DeepCharts chart are the same picture.
const GAMMA_STYLE = {
  CALL_WALL: { rgb: [196, 106, 106], width: 3, style: 'solid' },
  PUT_WALL: { rgb: [106, 191, 138], width: 3, style: 'solid' },
  FLIP: { rgb: [232, 212, 77], width: 3, style: 'dashed' },
  GAMMA_POS: { rgb: [127, 182, 217], width: 2, style: 'solid' },
  GAMMA_NEG: { rgb: [192, 138, 208], width: 2, style: 'solid' },
  PDH: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  PDL: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  ONH: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  ONL: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
};
const DEFAULT_GAMMA = { rgb: [242, 242, 242], width: 2, style: 'solid' };

const LINE_STYLE = { solid: 'line.style_solid', dashed: 'line.style_dashed', dotted: 'line.style_dotted' };

/** Strip anything a chat client could mangle, and quote for Pine. */
const q = (s) => `"${String(s).replace(/[^\x20-\x7e]/g, '').replace(/"/g, "'")}"`;

const rgb = (c) => `color.rgb(${c[0]}, ${c[1]}, ${c[2]})`;

function build(meta, opts = {}) {
  if (!meta || !meta.builtAt) throw new Error('pine.build: no builtAt - refusing to emit an undated script');
  if (!meta.levels || meta.levels.length === 0) throw new Error('pine.build: no levels to write');

  const day = String(meta.builtAt).slice(0, 10);
  const symbol = meta.symbol || 'NQ';
  const gam = meta.levels;

  const fracs = G.TABLE.map((t) => t.frac.toFixed(3)).join(', ');
  const codes = G.TABLE.map((t) => q(t.code)).join(', ');
  const cols = G.TABLE.map((t) => rgb(G.COLORS[t.grp])).join(', ');
  const labels = G.TABLE.map((t) => q(G.fracLabel(t.frac))).join(', ');
  // The extremes and equilibrium are the structure; the interior arrays are
  // detail. Drawing all seventeen identically is what makes a grid read as noise.
  const widths = G.TABLE.map((t) => (t.grp === 'Ext' || t.grp === 'Eq' ? 2 : 1)).join(', ');
  const dashes = G.TABLE.map((t) => (t.grp === 'Ext' || t.grp === 'Eq' ? 'false' : 'true')).join(', ');

  const gPrices = gam.map((l) => Number(l.price)).join(', ');
  const gLabels = gam.map((l) => q(l.label)).join(', ');
  const gCols = gam.map((l) => rgb((GAMMA_STYLE[l.type] || DEFAULT_GAMMA).rgb)).join(', ');
  const gWidths = gam.map((l) => (GAMMA_STYLE[l.type] || DEFAULT_GAMMA).width).join(', ');
  const gStyles = gam.map((l) => LINE_STYLE[(GAMMA_STYLE[l.type] || DEFAULT_GAMMA).style]).join(', ');

  return `//@version=6
// =====================================================================
//  Goldbach + Gamma - ${symbol}
//  Gamma levels built ${day} from CBOE's free delayed _NDX chain.
//
//  The Goldbach grid is arithmetic and never goes stale - it re-derives
//  itself from whatever price is on your chart.
//
//  The gamma levels are this morning's numbers written in. They are built
//  from open interest, which rebuild overnight, so they are right for one
//  session. Grab the new file each morning.
//
//  Context and targets, not triggers.
// =====================================================================
indicator("Goldbach + Gamma - ${symbol}", overlay = true, max_lines_count = 500, max_labels_count = 500, max_boxes_count = 20)

gG = "Goldbach"
showGb  = input.bool(true,  "Show the Goldbach grid",        group = gG)
po3Mode = input.string("Auto", "Range size", options = ["Auto", "27", "81", "243", "729", "2187", "6561"], group = gG)
shiftBl = input.int(0, "Shift the range (blocks)", minval = -3, maxval = 3, group = gG)
showExt = input.bool(true,  "Extensions (-0.111 / 1.111)",   group = gG)
showCE  = input.bool(true,  "CE midpoints",                  group = gG)
showSh  = input.bool(true,  "Shade premium / discount",      group = gG)
showLb  = input.bool(true,  "Labels",                        group = gG)

gX = "Gamma (built ${day})"
showGx  = input.bool(true,  "Show today's gamma levels",     group = gX)
showTag = input.bool(true,  "Show the build date on screen", group = gX)

fracs  = array.from(${fracs})
codes  = array.from(${codes})
fnames = array.from(${labels})
fcols  = array.from(${cols})
fwidth = array.from(${widths})
fdash  = array.from(${dashes})

gPrice = array.from(${gPrices})
gText  = array.from(${gLabels})
gCol   = array.from(${gCols})
gWid   = array.from(${gWidths})
gSty   = array.from(${gStyles})

// These prices are ${symbol} prices. On any other symbol they are meaningless,
// so the gamma half hides itself rather than drawing confident nonsense.
isRight = str.contains(syminfo.ticker, "${symbol}")

autoBlock(p) =>
    best  = 729.0
    bestd = 1e9
    for s in array.from(27.0, 81.0, 243.0, 729.0, 2187.0, 6561.0)
        d = math.abs(s / p - 0.03)
        if d < bestd
            bestd := d
            best  := s
    best

po3 = po3Mode == "Auto" ? autoBlock(close) : str.tonumber(po3Mode)
lo  = math.floor(close / po3) * po3 + shiftBl * po3
hi  = lo + po3
eq  = lo + po3 * 0.5

var line[]  LN = array.new<line>()
var label[] LB = array.new<label>()
var box[]   BX = array.new<box>()
var table   TG = table.new(position.bottom_right, 1, 1)

if barstate.islast
    // pop-until-empty, NOT "for i = 0 to size - 1". Pine counts DOWNWARD when
    // the end is below the start, so on an empty array that loop runs with
    // i = 0 and then i = -1 and throws.
    while array.size(LN) > 0
        line.delete(array.pop(LN))
    while array.size(LB) > 0
        label.delete(array.pop(LB))
    while array.size(BX) > 0
        box.delete(array.pop(BX))

    L = bar_index - 300
    R = bar_index + 30

    if showGb and showSh
        array.push(BX, box.new(L, hi, R, eq, border_color = color.new(color.red, 100), bgcolor = color.rgb(224, 90, 90, 96)))
        array.push(BX, box.new(L, eq, R, lo, border_color = color.new(color.green, 100), bgcolor = color.rgb(90, 200, 140, 96)))

    float prev = na
    if showGb
        for i = 0 to array.size(fracs) - 1
            f = array.get(fracs, i)
            // A wrapping condition rather than `continue` - the CE midpoint has
            // to be measured between DRAWN levels, so a skipped extension must
            // also be skipped by `prev`.
            if (f >= 0 and f <= 1) or showExt
                p = lo + (hi - lo) * f
                c = array.get(fcols, i)
                array.push(LN, line.new(L, p, R, p, extend = extend.both, color = c, width = array.get(fwidth, i), style = array.get(fdash, i) ? line.style_dashed : line.style_solid))
                if showLb
                    t = array.get(fnames, i) + "  " + array.get(codes, i) + "  " + str.tostring(p, "#,##0.00")
                    array.push(LB, label.new(R, p, t, style = label.style_label_left, textcolor = c, color = color.new(color.black, 80), size = size.small))
                if showCE and not na(prev)
                    m = (prev + p) / 2
                    array.push(LN, line.new(L, m, R, m, extend = extend.both, color = color.rgb(120, 130, 145, 40), width = 1, style = line.style_dotted))
                prev := p

    if showGx and isRight
        for i = 0 to array.size(gPrice) - 1
            p = array.get(gPrice, i)
            c = array.get(gCol, i)
            array.push(LN, line.new(L, p, R, p, extend = extend.both, color = c, width = array.get(gWid, i), style = array.get(gSty, i)))
            if showLb
                array.push(LB, label.new(R, p, array.get(gText, i), style = label.style_label_left, textcolor = c, color = color.new(color.black, 80), size = size.small))

    if showGx and not isRight
        array.push(LB, label.new(bar_index, close, "Gamma levels are ${symbol} prices - hidden on this symbol. The Goldbach grid still applies.", style = label.style_label_left, textcolor = color.rgb(232, 176, 72), color = color.new(color.black, 70), size = size.small))

    if showTag
        table.cell(TG, 0, 0, "Goldbach + Gamma   gamma built ${day}   walls rebuild overnight", text_color = color.rgb(170, 180, 195), bgcolor = color.new(color.black, 70), text_size = size.tiny)
`;
}

module.exports = { build, GAMMA_STYLE };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: all `pine.test.js` tests PASS, plus everything from Task 1 and all pre-existing tests.

- [ ] **Step 6: Mutation-test the no-basis rule**

Temporarily change `pine.js` so gamma prices are emitted as `Number(l.price) + (meta.basis || 0)`. Run `node --test`. Expected: `no basis is applied to the gamma prices` FAILS. Restore and re-run to green.

- [ ] **Step 7: Eyeball the real output once**

Run:

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
node -e "const p=require('./pine.js');const m=require('./tests/fixtures/latest-sample.json');console.log(p.build(m))" | head -40
```

Expected: a readable Pine script opening with `//@version=6`, the header naming the build date, and the input block. Read it — a generator's output is the deliverable, and no unit test will notice that it reads badly.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
git add pine.js tests/pine.test.js tests/fixtures/latest-sample.json
git commit -m "Generate the TradingView indicator from the morning levels build"
```

---

### Task 3: Write the file on the morning run

**Files:**
- Create: `build-pine.js`
- Modify: `.github/workflows/gamma.yml`
- Test: `tests/build-pine.test.js`

**Interfaces:**
- Consumes: `pine.js` `build(meta)`.
- Produces: a CLI entry point `node build-pine.js` that reads `levels/latest.json` and writes `tradingview/Goldbach-Gamma-NQ.txt` plus a dated archive `tradingview/Goldbach-Gamma-NQ-<YYYY-MM-DD>.txt`. Exports `run({ root })` → `{ written: string[], day: string }` for the test.

- [ ] **Step 1: Write the failing test**

Create `tests/build-pine.test.js`:

```js
/*
 * Writing the indicator to disk.
 *
 * The stable name is what a link points at; the dated copy is what makes a
 * bad morning diagnosable afterwards. Both, every time.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../build-pine.js');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-'));
  fs.mkdirSync(path.join(root, 'levels'));
  fs.copyFileSync(
    path.join(__dirname, 'fixtures', 'latest-sample.json'),
    path.join(root, 'levels', 'latest.json'),
  );
  return root;
}

test('it writes the stable name and a dated archive', () => {
  const root = scratch();
  const out = B.run({ root });
  assert.strictEqual(out.day, '2026-08-19');
  const stable = path.join(root, 'tradingview', 'Goldbach-Gamma-NQ.txt');
  const dated = path.join(root, 'tradingview', 'Goldbach-Gamma-NQ-2026-08-19.txt');
  assert.ok(fs.existsSync(stable), 'stable file missing');
  assert.ok(fs.existsSync(dated), 'dated archive missing');
  assert.strictEqual(fs.readFileSync(stable, 'utf8'), fs.readFileSync(dated, 'utf8'));
});

test('the written file is the generated script', () => {
  const root = scratch();
  B.run({ root });
  const txt = fs.readFileSync(path.join(root, 'tradingview', 'Goldbach-Gamma-NQ.txt'), 'utf8');
  assert.ok(txt.startsWith('//@version=6'));
  assert.ok(txt.includes('29900'));
});

test('no levels build means nothing is written, and it says so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-'));
  assert.throws(() => B.run({ root }), /latest\.json/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: FAIL — `Cannot find module '../build-pine.js'`

- [ ] **Step 3: Write the implementation**

Create `build-pine.js`:

```js
/*
 * Write the TradingView indicator for today.
 *
 *   node build-pine.js
 *
 * Reads the levels build that build-levels.js has already written. Writes two
 * copies: a stable name a link can point at, and a dated archive so a bad
 * morning can be looked at afterwards instead of argued about.
 *
 * Deliberately a separate entry point from build-levels.js. The levels build
 * fetches from CBOE and can fail on the network; this one is pure text and
 * cannot. Keeping them apart means a Pine change can never break the file the
 * DeepCharts injector downloads.
 */
const fs = require('node:fs');
const path = require('node:path');
const pine = require('./pine.js');

function run({ root = __dirname } = {}) {
  const metaPath = path.join(root, 'levels', 'latest.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`no levels/latest.json under ${root} - run build-levels.js first`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const src = pine.build(meta);
  const day = String(meta.builtAt).slice(0, 10);

  const dir = path.join(root, 'tradingview');
  fs.mkdirSync(dir, { recursive: true });

  const stable = path.join(dir, 'Goldbach-Gamma-NQ.txt');
  const dated = path.join(dir, `Goldbach-Gamma-NQ-${day}.txt`);
  fs.writeFileSync(stable, src);
  fs.writeFileSync(dated, src);

  return { written: [stable, dated], day };
}

if (require.main === module) {
  const out = run({});
  console.log(`indicator written for ${out.day}`);
  for (const f of out.written) console.log(`  ${path.basename(f)}`);
}

module.exports = { run };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: PASS.

- [ ] **Step 5: Wire it into the morning run only**

In `.github/workflows/gamma.yml`, find the step that runs `build-levels.js`. Immediately after it, add a step that runs only on the morning cadence:

```yaml
      # The indicator is text built from the levels that just landed. Morning
      # only: the intraday runs deliberately do not commit levels/, and a file
      # people paste into TradingView should change once a day, not every 30
      # minutes.
      - name: Build the TradingView indicator
        if: steps.cadence.outputs.morning == 'true'
        run: node build-pine.js
```

Then find the step that stages the morning commit (it runs `git add levels/`) and add the new directory to that same `git add`, so both land in one commit:

```bash
git add levels/ tradingview/
```

- [ ] **Step 6: Verify the workflow file is still valid YAML and the guard is right**

Run:

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
node -e "const s=require('fs').readFileSync('.github/workflows/gamma.yml','utf8');const i=s.indexOf('build-pine.js');console.log(i>0?'present':'MISSING');console.log(s.slice(Math.max(0,i-320), i+40))"
grep -n "git add" .github/workflows/gamma.yml
```

Expected: `present`, the surrounding text shows `if: steps.cadence.outputs.morning == 'true'` above the `run: node build-pine.js`, and the `git add` line now includes `tradingview/`.

- [ ] **Step 7: Run the whole thing against the real committed build**

Run:

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
node build-pine.js && wc -l tradingview/Goldbach-Gamma-NQ.txt && head -20 tradingview/Goldbach-Gamma-NQ.txt
```

Expected: it reports the day, writes both files, and the head shows the version line and the header.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
git add build-pine.js tests/build-pine.test.js .github/workflows/gamma.yml tradingview/
git commit -m "Build and commit the TradingView indicator on the morning run"
```

---

### Task 4: Attach it to the crew post, and document the one manual step

**Files:**
- Modify: `post-bot.js:117-124` (the `post()` FormData block) and its `message()` body
- Modify: `friends-update.js:38-45` (where `NQ-latest.xml` is read) and the `P.post({...})` call
- Modify: `README.md`
- Test: `tests/post-bot.test.js` (existing — add cases), `tests/friends-update.test.js` (existing — add a case)

**Interfaces:**
- Consumes: `post-bot.js` `post({ token, channelId, meta, xml, morning, changed, baseUrl, now })` — it builds its own `FormData` and already sends the XML as `files[0]`. There is **no injectable sender**; the existing tests point `baseUrl` at a throwaway local HTTP server and read the raw multipart body.
- Produces: `post()` gains one optional param, `pine` (a string or Buffer). When present it is appended as `files[1]` named `Goldbach-Gamma-NQ-<day>.txt`. Absent, the request is byte-for-byte what it is today.

- [ ] **Step 1: Write the failing test for the sender**

Add to `tests/post-bot.test.js`, reusing the `fakeDiscord()` helper already at the top of that file:

```js
test('the indicator rides along as a second attachment', async () => {
  const d = await fakeDiscord();
  const res = await P.post({
    token: 't', channelId: '123', meta: META, xml: '<levels/>',
    pine: '//@version=6\nindicator("x")', morning: true,
    baseUrl: d.base, now: new Date('2026-08-19T13:00:00Z'),
  });
  await d.close();
  assert.strictEqual(res.ok, true);
  const body = d.seen[0].body;
  assert.ok(body.includes('name="files[0]"'), 'the DeepCharts file must still be sent');
  assert.ok(body.includes('name="files[1]"'), 'the indicator must be sent alongside it');
  assert.ok(body.includes('Goldbach-Gamma-NQ-2026-08-19.txt'), 'named with the day');
  assert.ok(body.includes('//@version=6'), 'and carrying the script itself');
});

test('without an indicator the request is exactly what it is today', async () => {
  const d = await fakeDiscord();
  await P.post({
    token: 't', channelId: '123', meta: META, xml: '<levels/>',
    morning: true, baseUrl: d.base, now: new Date('2026-08-19T13:00:00Z'),
  });
  await d.close();
  const body = d.seen[0].body;
  assert.ok(body.includes('name="files[0]"'));
  assert.ok(!body.includes('name="files[1]"'), 'no empty second attachment');
});

test('the morning message tells a first-time reader what to do with it', async () => {
  const m = P.message({ meta: META, morning: true, changed: [], hasPine: true });
  const text = JSON.stringify(m);
  assert.match(text, /Pine Editor/);
  assert.match(text, /grab the new file/i);
});

test('it does not promise an indicator that was not attached', () => {
  const m = P.message({ meta: META, morning: true, changed: [], hasPine: false });
  assert.ok(!JSON.stringify(m).includes('Pine Editor'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: FAIL — no `files[1]`, and `message()` ignores `hasPine`.

- [ ] **Step 3: Implement in `post-bot.js`**

In `post()`, add `pine` to the destructured params and append it after the existing `files[0]` line:

```js
  // The indicator is an extra on top of the levels, so it is appended rather
  // than interleaved: with no indicator the request is byte-for-byte what it
  // has always been, and files[0] never moves.
  if (pine) {
    form.append('files[1]',
      new Blob([pine], { type: 'text/plain' }), `Goldbach-Gamma-NQ-${day}.txt`);
  }
```

Pass `hasPine: Boolean(pine)` into the `message({ ... })` call. In `message()`, accept `hasPine` and append to the description — only when true, and only on the morning post:

```js
  const pineLine = (morning && hasPine)
    ? '\n\n**TradingView:** open the Pine Editor, paste the .txt below, Add to chart. '
      + 'The Goldbach grid draws itself on any symbol. The gamma levels are '
      + "today's NQ numbers, so grab the new file tomorrow."
    : '';
```

and include `pineLine` in the `description` string.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: PASS, including every pre-existing `post-bot.test.js` case.

- [ ] **Step 5: Write the failing test for the runner**

Add to `tests/friends-update.test.js`, using the `workspace()` helper already in that file:

```js
test('the morning run attaches the indicator when it has been built', async () => {
  const w = workspace();
  fs.mkdirSync(path.join(w.dir, 'tradingview'));
  fs.writeFileSync(path.join(w.dir, 'tradingview', 'Goldbach-Gamma-NQ.txt'),
    '//@version=6\nindicator("x")');
  const d = await fakeDiscord();
  const res = await R.run({
    root: w.dir, token: 't', channelId: 'c', baseUrl: d.base,
    now: MIDDAY, morning: true,
  });
  await d.close();
  assert.strictEqual(res.posted, true);
  assert.ok(d.seen[0].body.includes('name="files[1]"'), 'indicator not attached');
});

test('a missing indicator does not stop the levels going out', async () => {
  // The indicator is an extra. If build-pine.js has not run, the crew still
  // get their levels rather than nothing at all.
  const w = workspace();
  const d = await fakeDiscord();
  const res = await R.run({
    root: w.dir, token: 't', channelId: 'c', baseUrl: d.base,
    now: MIDDAY, morning: true,
  });
  await d.close();
  assert.strictEqual(res.posted, true);
  assert.ok(!d.seen[0].body.includes('name="files[1]"'));
});
```

Note: `fakeDiscord()` in this file currently only counts hits. Extend it to record the request body the same way `tests/post-bot.test.js` does — `Buffer.concat(chunks).toString('latin1')` — keeping its existing `hits` behaviour so the tests already using it still pass.

- [ ] **Step 6: Implement in `friends-update.js`**

Beside the existing `NQ-latest.xml` read, add the indicator read, then pass it through:

```js
  // Read but never required. An absent indicator must not turn a levels post
  // into no post at all - the levels are the thing people are waiting for.
  let pine = null;
  if (morning) {
    try {
      pine = fs.readFileSync(path.join(root, 'tradingview', 'Goldbach-Gamma-NQ.txt'));
    } catch { /* not built yet - post the levels anyway */ }
  }
```

and add `pine` to the existing `P.post({ ... })` argument list. Nothing else in the function changes — in particular the "state is written only after Discord accepts" rule stays exactly as it is.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud && node --test`
Expected: every test passes, including all pre-existing cases in both files.

- [ ] **Step 8: Update the README**

`README.md` still describes the hourly gamma-check bot that was deleted on 2026-08-16 — it is wrong in every paragraph. Replace its body with what the repo does now:

- the morning build (levels → DeepCharts `.xml` → TradingView indicator), and the intraday change-only cadence
- the two Discord destinations: the public channel via `DISCORD_WEBHOOK`, and the private crew channel via the bot
- **plainly, in its own short section:** the crew bot needs `FRIENDS_BOT_TOKEN` and `FRIENDS_CHANNEL_ID`, neither of which is set. Until someone runs `Connect Friends Bot.bat` once, `friends-update.js` returns "not configured" on every run and sends nothing. This is the single most useful sentence in the file — it is not obvious from a green Actions run.
- that the levels are context and targets, not triggers

- [ ] **Step 9: Commit**

```bash
cd /c/Users/lalos/Desktop/Claude/gamma-discord-cloud
git add post-bot.js friends-update.js tests/post-bot.test.js tests/friends-update.test.js README.md
git commit -m "Attach the indicator to the crew post, and describe what this repo actually does now"
```

---

## Verification before calling it done

- [ ] `node --test` from the repo root: every test passes, none skipped.
- [ ] `node build-pine.js` produces a file that opens with `//@version=6` and contains today's walls.
- [ ] The generated script has been read once by a human, not just asserted against.
- [ ] `git status` shows nothing unexpected staged — this repo has had other sessions' work swept into commits.
- [ ] The Pine has NOT been compile-checked, because it cannot be here. Say so plainly: Brandon pastes it into TradingView and reports red errors, which is the standing workflow for every Pine script in this stack.
