/*
 * Should we post the levels again, or stay quiet?
 *
 * The morning post is the daily anchor and always goes out. Between then and
 * the close we rebuild every half hour and post ONLY when a number a person
 * would actually redraw has moved. Four guards keep that honest:
 *
 *   - a 10-point tolerance, so continuous drift is not mistaken for news
 *   - 90 minutes minimum between posts
 *   - 3 posts a day, maximum
 *   - nothing at all outside a live CME session
 *
 * Why a tolerance and not a rounded hash: the gamma flip is a computed
 * crossing that moves with the NDX->NQ basis, so it drifts by fractions of a
 * point continuously. Rounding to a grid looks like it fixes that and does
 * not - 29450.76 and 29452.76 sit either side of a 5-point boundary, so the
 * smallest possible drift still reads as a change. Comparing against the last
 * POSTED value with a tolerance has no such cliff, and it names which levels
 * moved, which the post itself then uses.
 *
 * Everything here is pure: same inputs, same answer, no clock and no disk.
 * The caller owns reading and writing the state file.
 */

// A level has moved if it is more than this many NQ points from where it was.
// Strikes on the NDX grid land ~25 points apart once scaled, and the flip
// drifts by low single digits, so 10 separates a real move from noise.
const TOLERANCE = 10;
// How fresh the channel is allowed to be. The workflow already wakes every 30
// minutes; this is what decides whether a wake is allowed to speak. It was 90
// minutes with a cap of 3, which meant a wall could move at 10:05 and nobody
// heard about it until 11:30.
//
// The gap is the cadence control. The cap is a runaway backstop only - set far
// above any real day so that a stuck fingerprint or a clock problem is bounded,
// while an ordinary session is limited by the 30 minutes and by `moved()`.
// A cap low enough to bind is a cap that silences the channel by lunchtime.
const MIN_GAP_MINUTES = 30;
const MAX_PER_DAY = 20;

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
});

/** New York wall-clock parts for an instant, with real daylight saving. */
function etParts(date) {
  const p = {};
  for (const { type, value } of ET.formatToParts(date)) p[type] = value;
  return {
    weekday: p.weekday,
    hour: Number(p.hour),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

/** The New York calendar date, which is the day the daily cap counts against. */
function etDate(date) {
  return etParts(date).date;
}

/**
 * Is the CME equity-index session live?
 *
 * Opens Sunday 18:00 ET, closes Friday 17:00 ET, with a one-hour maintenance
 * break at 17:00 every day in between. Derived from a real timezone rather
 * than a fixed offset - a hardcoded -240 puts every winter session an hour out.
 */
function sessionOpen(date) {
  const { weekday, hour } = etParts(date);
  if (weekday === 'Sat') return false;
  if (weekday === 'Sun') return hour >= 18;
  if (weekday === 'Fri') return hour < 17;
  return hour !== 17;
}

/** Prices for one level type, low to high, so ordering cannot fake a change. */
function byType(levels) {
  const out = new Map();
  for (const l of levels || []) {
    if (!l || typeof l !== 'object') continue;
    const price = Number(l.price);
    if (!Number.isFinite(price)) continue;
    const key = String(l.type);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(price);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/**
 * Which level types differ between two builds, beyond the tolerance.
 *
 * Compares each type's sorted price list elementwise. Matching on type alone
 * would compare only the first of the six gamma shelves and miss the rest;
 * a differing count (a level appeared or vanished) is always a change.
 */
function moved(prev, next, tol = TOLERANCE) {
  const a = byType(prev);
  const b = byType(next);
  const changed = new Set();
  for (const type of new Set([...a.keys(), ...b.keys()])) {
    const was = a.get(type) || [];
    const now = b.get(type) || [];
    if (was.length !== now.length) { changed.add(type); continue; }
    if (was.some((price, i) => Math.abs(price - now[i]) > tol)) changed.add(type);
  }
  return [...changed].sort();
}

/** A state file can be missing, half-written or hand-edited. Never throw. */
function normalise(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return {
    day: typeof state.day === 'string' ? state.day : '',
    count: Number.isFinite(state.count) ? state.count : 0,
    lastAt: typeof state.lastAt === 'string' ? state.lastAt : '',
    levels: Array.isArray(state.levels) ? state.levels : null,
  };
}

function minutesBetween(iso, now) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return Infinity;
  return (now.getTime() - then) / 60000;
}

/**
 * decide({ levels, state, now, morning }) -> { post, reason, changed, nextState }
 *
 * `nextState` is the state to persist. On a skip it is the state that came in,
 * byte for byte: advancing lastAt on a skip would re-arm the 90-minute gate on
 * every half-hourly check, so a real change could never get through.
 */
function decide({ levels, state, now = new Date(), morning = false }) {
  const built = Array.isArray(levels) ? levels : [];
  const prior = normalise(state);
  const changed = moved(prior && prior.levels, built);
  const skip = (reason) => ({ post: false, reason, changed, nextState: state });

  // An empty build is a failed fetch, not thirteen levels vanishing at once.
  if (!built.length) return skip('no levels were built');
  if (!sessionOpen(now)) return skip('the market is closed');

  const today = etDate(now);
  const countToday = prior && prior.day === today ? prior.count : 0;

  if (!morning) {
    if (!changed.length) return skip('nothing moved since the last post');
    if (countToday >= MAX_PER_DAY) {
      return skip(`daily cap reached - ${MAX_PER_DAY} already posted today`);
    }
    const gap = prior ? minutesBetween(prior.lastAt, now) : Infinity;
    if (gap < MIN_GAP_MINUTES) {
      return skip(
        `too soon - last post was ${Math.round(gap)} min ago, `
        + `minimum gap is ${MIN_GAP_MINUTES} min`);
    }
  }

  return {
    post: true,
    reason: morning ? 'the daily morning post' : `moved: ${changed.join(', ')}`,
    changed,
    nextState: {
      day: today,
      count: morning ? 1 : countToday + 1,
      lastAt: now.toISOString(),
      levels: built,
    },
  };
}

module.exports = { moved, sessionOpen, decide, etDate, TOLERANCE, MIN_GAP_MINUTES, MAX_PER_DAY };
