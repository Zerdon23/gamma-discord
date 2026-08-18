/*
 * Which NDX->NQ basis to trust, and when a measurement is worth believing.
 *
 * THE DEFECT THIS EXISTS TO FIX
 *
 * The basis is measured as (NQ future) - (NDX index). CBOE's delayed chain
 * serves the PRIOR SESSION'S close outside cash hours, while Yahoo's NQ=F is
 * live around the clock - so a basis taken off-hours is the true basis plus
 * however far NQ has travelled since that close. Every committed build showed
 * it, and 30046.14 (Friday 14 August's close) was reused for three days:
 *
 *   2026-08-16 18:11Z  ->   96   correct, by luck: market shut, both legs stale
 *   2026-08-17 01:34Z  ->  187   ~92 points wrong
 *   2026-08-17 13:21Z  ->  172   ~77 points wrong
 *   2026-08-18 13:24Z  -> -300   ~395 points wrong, and it shipped
 *
 * Two guards, and BOTH are needed. A plausibility band alone would have passed
 * the 172; only refusing to measure outside cash hours catches that one. And
 * the band alone cannot help the morning build at all, because the morning
 * build has no valid measurement to fall back on - hence the carry.
 *
 * The carry is safe because the basis is carry, not noise: roughly
 * spot x (rate - dividend yield) x time to expiry, which drifts a couple of
 * points a day and steps only at a quarterly roll. Yesterday's real
 * measurement is worth ~3 points of error against today's 395.
 */

// A front-month index-future basis is bounded by carry. NDX yields ~0.7%
// against ~4% rates, so it is positive and a few tens to low hundreds of
// points, widest just after a quarterly roll and converging on zero at expiry.
// A small negative is allowed for a dividend-heavy stretch near expiry.
const MIN = -50;
const MAX = 400;

// Long enough to carry across a three-day weekend, short enough that a
// quarterly roll cannot be papered over.
const MAX_CARRY_HOURS = 96;

// NDX cash trades 09:30-16:00 ET. The chain runs ~15 minutes behind, so its
// "spot" only stops being the prior close around 09:45.
const OPEN_MINUTE = 9 * 60 + 45;
const CLOSE_MINUTE = 16 * 60;

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function etParts(date) {
  const p = {};
  for (const { type, value } of ET.formatToParts(date)) p[type] = value;
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Could this number be a real NDX->NQ basis? */
function plausible(basis) {
  // Number(null) is 0 and Number('') is 0, both of which sit inside the band.
  // A coerced zero would draw every index strike on the chart unshifted, so
  // the type check has to come first.
  if (typeof basis !== 'number' || !Number.isFinite(basis)) return false;
  return basis >= MIN && basis <= MAX;
}

/** Is the cash index trading right now, allowing for the feed's delay? */
function cashOpen(date) {
  const { weekday, minutes } = etParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= OPEN_MINUTE && minutes < CLOSE_MINUTE;
}

function ageHours(measuredAt, now) {
  const then = Date.parse(measuredAt);
  if (!Number.isFinite(then)) return Infinity;
  // A negative age means a clock skew or a hand-edited file. Treat it as
  // unusable rather than as infinitely fresh.
  const hours = (now.getTime() - then) / 3600000;
  return hours < 0 ? Infinity : hours;
}

/**
 * choose({ measured, carried, now }) -> { basis, source, ageHours, store }
 *
 * Throws when neither a believable measurement nor a usable carry exists.
 * Refusing is the point: index strikes drawn on an NQ chart look exactly as
 * authoritative as correct ones.
 */
function choose({ measured, carried, now = new Date() }) {
  if (plausible(measured) && cashOpen(now)) {
    return { basis: measured, source: 'measured', ageHours: 0, store: true };
  }

  const usable = carried && typeof carried === 'object' && !Array.isArray(carried)
    ? carried : null;
  if (usable && plausible(usable.basis)) {
    const age = ageHours(usable.measuredAt, now);
    if (age <= MAX_CARRY_HOURS) {
      return { basis: usable.basis, source: 'carried', ageHours: age, store: false };
    }
    throw new Error(
      `the last real basis is stale (${Math.round(age)}h old, limit ${MAX_CARRY_HOURS}h) `
      + '- refusing to build rather than draw a rolled contract\'s carry out of place');
  }

  throw new Error(
    'no believable NQ basis: '
    + `measurement ${JSON.stringify(measured)} was ${plausible(measured)
      ? 'taken outside cash hours' : 'implausible'}`
    + ', and there is no usable carried value - refusing to write index prices '
    + 'onto an NQ chart');
}

module.exports = { plausible, cashOpen, choose, MIN, MAX, MAX_CARRY_HOURS };
