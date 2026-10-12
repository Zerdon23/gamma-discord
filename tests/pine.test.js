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
// Stand-ins for the private AQQ fragments - the real ones are not in this repo.
const FRAG = { smt: '// SMT FRAGMENT\n', levels: '// LEVELS FRAGMENT\n' };

const meta = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'latest-sample.json'), 'utf8'),
);

test('it is a version 6 indicator with the drawing caps declared', () => {
  const src = P.build(meta, FRAG);
  assert.ok(src.startsWith('//@version=6'), 'must open with the version line');
  assert.match(src, /max_lines_count\s*=\s*\d+/);
  assert.match(src, /max_labels_count\s*=\s*\d+/);
});

test('ASCII only - a chat client must not be able to mangle it', () => {
  // eslint-disable-next-line no-control-regex
  const bad = P.build(meta, FRAG).match(/[^\x09\x0a\x0d\x20-\x7e]/g);
  assert.strictEqual(bad, null, `non-ASCII found: ${JSON.stringify(bad)}`);
});

test("the real build's middle dot becomes a hyphen, not a hole", () => {
  // levels/latest.json really does write "+GAMMA 30,000 - 503m" with U+00B7.
  // Stripping it would leave a double space and read as a bug; it is
  // transliterated so the label still says what it said.
  const src = P.build(meta, FRAG);
  assert.ok(src.includes('+GAMMA 30,000 - 503m'), 'the shelf label must survive readably');
  assert.ok(!src.includes('30,000  503m'), 'and must not be left with a gap');
});

test('every gamma price is written through unchanged', () => {
  const src = P.build(meta, FRAG);
  for (const lv of meta.levels) {
    assert.ok(src.includes(String(lv.price)), `missing price ${lv.price}`);
  }
});

test('no basis is applied to the gamma prices', () => {
  // The wall is 29900 and the basis is 96. If anyone ever "helpfully" adds the
  // basis, 29996 appears and this fails.
  const src = P.build(meta, FRAG);
  assert.ok(src.includes('29900'), 'the wall itself must be present');
  assert.ok(!src.includes('29996'), 'the basis must NOT be added a second time');
});

test('the AQQ Levels and SMT fragments are spliced in whole', () => {
  const src = P.build(meta, FRAG);
  assert.ok(src.includes('// SMT FRAGMENT'), 'SMT missing');
  assert.ok(src.includes('// LEVELS FRAGMENT'), 'AQQ Levels missing');
});

test('no fragments, no script - a gamma-only file must not ship under the AQQ name', () => {
  assert.throws(() => P.build(meta), /fragments/);
  assert.throws(() => P.build(meta, { smt: 'x' }), /fragments/);
});

test('the Goldbach grid is gone (removed 2026-10-12 at his ask)', () => {
  assert.ok(!/goldbach|gbx/i.test(P.build(meta, FRAG)));
});

test('the build date is stamped where a reader will see it', () => {
  const src = P.build(meta, FRAG);
  assert.ok(src.includes('2026-08-19'), 'the build date must appear');
  assert.match(src, /rebuild overnight/i, 'and say the walls are one session old');
});

test('it guards the symbol, because these prices are NQ prices', () => {
  const src = P.build(meta, FRAG);
  assert.match(src, /syminfo\.ticker/);
  assert.match(src, /str\.contains/);
});

test('a build with no levels is refused rather than emitted empty', () => {
  assert.throws(() => P.build({ builtAt: meta.builtAt, levels: [] }, FRAG), /no levels/i);
  assert.throws(() => P.build({ levels: meta.levels }, FRAG), /builtAt/i);
});

test('every gamma price is a float literal, because Pine types an array by its first element', () => {
  // array.from(29900, 29300, 29450.76) declares an array<int> and is then
  // handed a float. Walls land on whole numbers and the flip does not, so the
  // integer is nearly always first. Every literal must carry a decimal point.
  const src = P.build(meta, FRAG);
  const line = src.split('\n').find((l) => l.startsWith('gPrice'));
  assert.ok(line, 'the gamma price array must exist');
  const nums = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')')).split(',');
  for (const n of nums) {
    assert.match(n.trim(), /^-?\d+\.\d+$/, `"${n.trim()}" is not a float literal`);
  }
});

test('the empty-array loop trap is not present', () => {
  // `for i = 0 to array.size(x) - 1` counts DOWNWARD when the array is empty,
  // running with i = 0 and then i = -1, and throws. The clear-down must pop.
  const src = P.build(meta, FRAG);
  assert.ok(!/for\s+\w+\s*=\s*0\s+to\s+array\.size\(gxLN\)/.test(src), 'clear-down must not use a for');
  assert.match(src, /while array\.size\(gxLN\) > 0/);
});

/*
 * Name collisions with his OTHER TradingView scripts.
 *
 * 2026-08-20: pasting this indicator produced `"gG" is already defined`
 * (CE10095). The generated file was clean - it was sharing a Pine Editor tab
 * with his Gamma Suite script, which also declares `gG`, and a bare `lo`
 * collided the same way. A first fix using `gb*` then collided with his AXION
 * Levels script, which carries its own Goldbach block.
 *
 * Pine cannot stop two scripts sharing one tab. It costs nothing to make sure
 * the name that collides is never one of ours, so every top-level name this
 * generator declares is either descriptive or carries the gx prefix.
 */
test('no short generic top-level names - they collide across his scripts', () => {
  const src = P.build(meta, FRAG);
  const generic = [];
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=[^=]/);
    if (m && m[1].length <= 3 && !m[1].startsWith('gx')) generic.push(m[1]);
  }
  assert.deepStrictEqual(generic, [],
    `short generic names invite a cross-script collision: ${generic.join(', ')}`);
});
