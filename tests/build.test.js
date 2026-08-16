const test = require('node:test');
const assert = require('node:assert');
const B = require('../build-levels.js');

const GEX = {
  spot: 29000, callWall: 29500, putWall: 28500, flip: 29100,
  netGex: 1e9, regime: 'positive',
  top: [
    { strike: 29500, gex: 9e8 },
    { strike: 28500, gex: -7e8 },
    { strike: 29200, gex: 3e8 },
    { strike: 28800, gex: -2e8 },
  ],
};
const SESS = { pdh: 29800, pdl: 29300, onh: 29750, onl: 29400 };
const find = (levels, type) => levels.find((l) => l.type === type);

test('the NQ basis is added to every option-derived level exactly once', () => {
  const { levels } = B.buildLevels({ gex: GEX, basis: 250, sess: {} });
  assert.strictEqual(find(levels, 'CALL_WALL').price, 29750, '29500 + 250');
  assert.strictEqual(find(levels, 'PUT_WALL').price, 28750, '28500 + 250');
  assert.strictEqual(find(levels, 'FLIP').price, 29350, '29100 + 250');
  assert.strictEqual(find(levels, 'GAMMA_POS').price, 29450, '29200 + 250');
});

test('session levels are already NQ prices and are NOT shifted', () => {
  // They come from NQ=F, not from the index. Shifting them would move real
  // NQ prices by the basis a second time.
  const { levels } = B.buildLevels({ gex: GEX, basis: 250, sess: SESS });
  assert.strictEqual(find(levels, 'PDH').price, 29800);
  assert.strictEqual(find(levels, 'ONL').price, 29400);
});

test('a null session level is omitted, never drawn as zero', () => {
  const { levels } = B.buildLevels({ gex: GEX, basis: 0, sess: { pdh: null, pdl: 29300 } });
  assert.strictEqual(find(levels, 'PDH'), undefined);
  assert.strictEqual(find(levels, 'PDL').price, 29300);
});

test('a missing basis is refused rather than silently drawing index prices', () => {
  // Index strikes on an NQ chart are hundreds of points wrong and look exactly
  // as authoritative as correct ones. No file beats a confidently wrong file.
  assert.throws(() => B.buildLevels({ gex: GEX, basis: null, sess: {} }), /basis/i);
  assert.throws(() => B.buildLevels({ gex: GEX, basis: undefined, sess: {} }), /basis/i);
  assert.throws(() => B.buildLevels({ gex: GEX, basis: NaN, sess: {} }), /basis/i);
});

test('an implausible basis is refused', () => {
  assert.throws(() => B.buildLevels({ gex: GEX, basis: 9000, sess: {} }), /basis/i);
});

test('a basis of zero is allowed - it is a real measurement', () => {
  // Rejecting 0 would treat "the future is at parity" as a failure.
  const { levels } = B.buildLevels({ gex: GEX, basis: 0, sess: {} });
  assert.strictEqual(find(levels, 'CALL_WALL').price, 29500);
});

test('gamma shelves exclude the strikes already drawn as walls', () => {
  // The same price drawn twice reads as one thicker line and wastes a label.
  const { levels } = B.buildLevels({ gex: GEX, basis: 0, sess: {} });
  const shelves = levels.filter((l) => l.type.startsWith('GAMMA_'));
  assert.ok(!shelves.some((l) => l.price === 29500), 'call wall redrawn as a shelf');
  assert.ok(!shelves.some((l) => l.price === 28500), 'put wall redrawn as a shelf');
  assert.ok(shelves.some((l) => l.price === 29200));
});

test('shelf sign follows the gamma, not the side of spot', () => {
  const { levels } = B.buildLevels({ gex: GEX, basis: 0, sess: {} });
  assert.strictEqual(find(levels, 'GAMMA_POS').price, 29200, 'positive gex -> positive shelf');
  assert.strictEqual(find(levels, 'GAMMA_NEG').price, 28800, 'negative gex -> negative shelf');
});

test('no duplicate prices survive into the file', () => {
  const dup = { ...GEX, top: [{ strike: 29200, gex: 3e8 }, { strike: 29200, gex: 1e8 }] };
  const { levels } = B.buildLevels({ gex: dup, basis: 0, sess: {} });
  const prices = levels.map((l) => l.price);
  assert.strictEqual(new Set(prices).size, prices.length);
});

test('labels name the level in plain words and carry the price', () => {
  const { levels } = B.buildLevels({ gex: GEX, basis: 0, sess: SESS });
  assert.match(find(levels, 'CALL_WALL').label, /CALL WALL/);
  assert.match(find(levels, 'CALL_WALL').label, /29,500/);
  assert.match(find(levels, 'FLIP').label, /GAMMA FLIP/);
  assert.match(find(levels, 'PDH').label, /PRIOR DAY HIGH/);
});

test('a flip of zero means no flip and is not drawn at price zero', () => {
  // gammaflip returns 0 for "could not price one". A line at 0 would sit at the
  // very bottom of the chart looking like a real level.
  const { levels } = B.buildLevels({ gex: { ...GEX, flip: 0 }, basis: 250, sess: {} });
  assert.strictEqual(find(levels, 'FLIP'), undefined);
});

test('meta records what the file is and how it was built', () => {
  const { meta } = B.buildLevels({ gex: GEX, basis: 250, sess: SESS });
  assert.strictEqual(meta.basis, 250);
  assert.strictEqual(meta.nqSpot, 29250);
  assert.strictEqual(meta.regime, 'positive');
  assert.match(meta.source, /CBOE/);
  assert.ok(meta.builtAt);
  assert.match(meta.note, /not triggers/i, 'the honesty note travels with the data');
});
