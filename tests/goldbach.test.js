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
  // Rounded to a cent, like every other price this module emits - a level
  // drawn at 29899.934999999998 is float noise on a chart, not precision.
  const first = G.levels(G.range(30100, 729), { ext: false }).slice(0, 2);
  const mid = (first[0].price + first[1].price) / 2;
  assert.strictEqual(without[0].price, Math.round(mid * 100) / 100);
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
