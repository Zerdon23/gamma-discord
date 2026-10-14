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
const G = require('../goldbach.js');

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

test("the real build's middle dot becomes a hyphen, not a hole", () => {
  // levels/latest.json really does write "+GAMMA 30,000 - 503m" with U+00B7.
  // Stripping it would leave a double space and read as a bug; it is
  // transliterated so the label still says what it said.
  const src = P.build(meta);
  assert.ok(src.includes('+GAMMA 30,000 - 503m'), 'the shelf label must survive readably');
  assert.ok(!src.includes('30,000  503m'), 'and must not be left with a gap');
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

test('every gamma price is a float literal, because Pine types an array by its first element', () => {
  // array.from(29900, 29300, 29450.76) declares an array<int> and is then
  // handed a float. Walls land on whole numbers and the flip does not, so the
  // integer is nearly always first. Every literal must carry a decimal point.
  const src = P.build(meta);
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
  const src = P.build(meta);
  assert.ok(!/for\s+\w+\s*=\s*0\s+to\s+array\.size\(LN\)/.test(src), 'clear-down must not use a for');
  assert.match(src, /while array\.size\(LN\) > 0/);
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
 * generator declares is either descriptive or carries the gbx prefix.
 */
test('no short generic top-level names - they collide across his scripts', () => {
  const src = P.build(meta);
  const generic = [];
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=[^=]/);
    if (m && m[1].length <= 3 && !m[1].startsWith('gbx')) generic.push(m[1]);
  }
  assert.deepStrictEqual(generic, [],
    `short generic names invite a cross-script collision: ${generic.join(', ')}`);
});

test('the Goldbach range vars keep the gbx prefix', () => {
  const src = P.build(meta);
  for (const n of ['gbxLo', 'gbxHi', 'gbxEq', 'gbxGroup']) {
    // Deliberately not a template literal: \b inside one is a
    // BACKSPACE character, so the obvious RegExp hunts U+0008 and never
    // matches - that is what failed this test against a correct file.
    // No escape sequences on purpose. This assertion has now been mangled
    // twice by shell quoting, and a backslash-b inside a template literal
    // is a BACKSPACE anyway - the obvious RegExp hunts U+0008 and never
    // matches, which is how a correct file failed this test.
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const decls = src.split(LF).map((l) => l.split(CR).join(''));
    assert.ok(decls.some((l) => l.startsWith(n + ' ') || l.startsWith(n + '=')),
      n + ' is not declared');
  }
  // The exact names that bit him.
  assert.ok(!/^gG\s*=/m.test(src), 'gG is back - it collides with Gamma Suite');
  assert.ok(!/^lo\s*=/m.test(src), 'lo is back - it collides with Gamma Suite');
});
