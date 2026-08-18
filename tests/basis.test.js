/*
 * Which NDX->NQ basis do we trust?
 *
 * Measured from real committed builds. CBOE's delayed chain serves the PRIOR
 * SESSION'S close outside cash hours, so a basis taken then is the true basis
 * plus however far NQ has travelled since that close:
 *
 *   2026-08-16 18:11Z  NDX 30046.14  NQ 30142.14  ->   96   correct (market shut, both legs stale together)
 *   2026-08-17 01:34Z  NDX 30046.14  NQ 30233.14  ->  187   ~92 points wrong
 *   2026-08-17 13:21Z  NDX 30046.14  NQ 30218.14  ->  172   ~77 points wrong  (Friday's close, on a Monday)
 *   2026-08-18 13:24Z  NDX 29995.38  NQ 29695.38  -> -300   ~395 points wrong
 *
 * 30046.14 is Friday 14 August's close, reused for three days running.
 */
const test = require('node:test');
const assert = require('node:assert');
const B = require('../basis.js');

// Cash hours are 09:30-16:00 ET; the chain is ~15 minutes behind, so a spot
// read before ~09:45 is still the prior close even though the market is open.
const OPEN = new Date('2026-08-18T16:00:00Z');   // Tuesday 12:00 ET
const EARLY = new Date('2026-08-18T12:30:00Z');  // Tuesday 08:30 ET - the morning cron
const carried = (over = {}) => ({
  basis: 96, measuredAt: '2026-08-17T18:00:00Z', ...over,
});

// ---------------------------------------------------------------- plausible

test('a real basis is plausible', () => {
  // Carry: spot x (rate - dividend yield) x time to expiry. About +78 a month
  // out, more just after a quarterly roll, converging on zero at expiry.
  for (const b of [96, 187, 40, 250, 0]) {
    assert.strictEqual(B.plausible(b), true, `${b} should be plausible`);
  }
});

test('the stale-pairing values that actually shipped are refused', () => {
  assert.strictEqual(B.plausible(-300), false, 'the 2026-08-18 build');
});

test('a basis far outside carry is refused in both directions', () => {
  for (const b of [-500, 900, 2000, -2000]) {
    assert.strictEqual(B.plausible(b), false, `${b} should be refused`);
  }
});

test('a missing or non-numeric basis is refused, never coerced', () => {
  // Number(null) is 0, which is inside the band. A silent zero would put every
  // index strike on the chart unshifted.
  for (const b of [null, undefined, NaN, '', 'ninety', {}]) {
    assert.strictEqual(B.plausible(b), false, `${JSON.stringify(b)} should be refused`);
  }
});

// ----------------------------------------------------------------- cashOpen

test('the cash index is open midday on a weekday', () => {
  assert.strictEqual(B.cashOpen(OPEN), true);
});

test('the 08:30 ET morning cron is NOT a cash-open moment', () => {
  // This is the whole defect: the morning build runs an hour before NDX opens.
  assert.strictEqual(B.cashOpen(EARLY), false);
});

test('the first minutes after the open are still too early', () => {
  // 13:35Z = 09:35 ET. The chain is 15 minutes behind, so its "spot" is still
  // 09:20 - which is the prior close.
  assert.strictEqual(B.cashOpen(new Date('2026-08-18T13:35:00Z')), false);
  assert.strictEqual(B.cashOpen(new Date('2026-08-18T13:50:00Z')), true);
});

test('after the 16:00 ET close it is no longer a measuring window', () => {
  assert.strictEqual(B.cashOpen(new Date('2026-08-18T20:05:00Z')), false);
});

test('weekends are not measuring windows', () => {
  // Saturday and Sunday midday.
  assert.strictEqual(B.cashOpen(new Date('2026-08-15T16:00:00Z')), false);
  assert.strictEqual(B.cashOpen(new Date('2026-08-16T16:00:00Z')), false);
});

test('cash hours follow real daylight saving', () => {
  // 16:00Z is 12:00 EDT in August but 11:00 EST in January - both inside cash
  // hours. 21:00Z is 17:00 EDT (shut) but 16:00 EST (also shut, at the bell).
  assert.strictEqual(B.cashOpen(new Date('2026-01-20T16:00:00Z')), true);
  assert.strictEqual(B.cashOpen(new Date('2026-01-20T21:00:00Z')), false);
});

// ------------------------------------------------------------------- choose

test('a fresh measurement during cash hours wins', () => {
  const r = B.choose({ measured: 101, carried: carried(), now: OPEN });
  assert.strictEqual(r.basis, 101);
  assert.strictEqual(r.source, 'measured');
});

test('outside cash hours the carried basis is used, not the measurement', () => {
  // The 2026-08-17 build: 172 was plausible AND completely wrong. The band
  // alone cannot save you here - only refusing to measure off-hours can.
  const r = B.choose({ measured: 172, carried: carried(), now: EARLY });
  assert.strictEqual(r.basis, 96);
  assert.strictEqual(r.source, 'carried');
});

test('the shipped -300 falls back to the carried basis', () => {
  const r = B.choose({ measured: -300, carried: carried(), now: EARLY });
  assert.strictEqual(r.basis, 96);
});

test('an implausible measurement is rejected even during cash hours', () => {
  const r = B.choose({ measured: -300, carried: carried(), now: OPEN });
  assert.strictEqual(r.source, 'carried');
});

test('a stale carried basis is refused rather than used', () => {
  // A quarterly roll moves the basis in one step. Papering over a week-old
  // value would draw every level a contract's worth of carry out of place.
  assert.throws(
    () => B.choose({
      measured: -300, now: EARLY,
      carried: carried({ measuredAt: '2026-08-01T18:00:00Z' }),
    }),
    /stale|old/i);
});

test('no measurement and no carry refuses to build', () => {
  // Refusing is the point. Index strikes drawn on an NQ chart look exactly as
  // authoritative as correct ones.
  assert.throws(() => B.choose({ measured: null, carried: null, now: EARLY }),
    /basis/i);
});

test('a corrupt carry file is treated as no carry', () => {
  for (const c of ['nonsense', 42, [], {}, { basis: 'ninety' }]) {
    assert.throws(() => B.choose({ measured: -300, carried: c, now: EARLY }), /basis/i);
  }
});

test('the age of a carried basis is reported, so the log can say so', () => {
  const r = B.choose({ measured: 172, carried: carried(), now: EARLY });
  assert.ok(r.ageHours > 0 && r.ageHours < 96, `got ${r.ageHours}`);
});

test('a measurement taken in cash hours is marked storable, a carry is not', () => {
  assert.strictEqual(B.choose({ measured: 101, carried: null, now: OPEN }).store, true);
  assert.strictEqual(B.choose({ measured: 172, carried: carried(), now: EARLY }).store, false);
});

test('a carried basis from the future is refused, not trusted', () => {
  // A clock skew or a hand-edited file must not extend the carry window.
  assert.throws(
    () => B.choose({
      measured: -300, now: EARLY,
      carried: carried({ measuredAt: '2027-01-01T00:00:00Z' }),
    }),
    /stale|old|future/i);
});
