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
