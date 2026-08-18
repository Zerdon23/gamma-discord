/*
 * The decision layer: should we post again, or stay quiet?
 *
 * Every level in this file is a verbatim record from a real levels/latest.json
 * build, not a shape I invented. A fixture written from imagination validates
 * the imagination.
 */
const test = require('node:test');
const assert = require('node:assert');
const N = require('../notify.js');

// A real morning build, trimmed to the levels the rules actually turn on.
const LEVELS = [
  { type: 'CALL_WALL', price: 29710, label: 'CALL WALL 29,710' },
  { type: 'PUT_WALL', price: 29700, label: 'PUT WALL 29,700' },
  { type: 'FLIP', price: 29450.76, label: 'GAMMA FLIP 29,451' },
  { type: 'GAMMA_POS', price: 29900, label: '+GAMMA 29,900 · 503m' },
  { type: 'GAMMA_NEG', price: 29300, label: '-GAMMA 29,300 · 378m' },
  { type: 'PDH', price: 30287.5, label: 'PRIOR DAY HIGH 30,288' },
  { type: 'PDL', price: 30067, label: 'PRIOR DAY LOW 30,067' },
  { type: 'ONH', price: 30121, label: 'OVERNIGHT HIGH 30,121' },
  { type: 'ONL', price: 29681, label: 'OVERNIGHT LOW 29,681' },
];

// Tuesday 2026-08-18, 14:00 ET — mid-session, well clear of every boundary.
const MIDDAY = new Date('2026-08-18T18:00:00Z');
const clean = (over = {}) => ({
  day: '2026-08-18', count: 1, lastAt: '2026-08-18T12:30:00Z',
  levels: LEVELS, ...over,
});
// Far enough back that the 90-minute gate is never what blocks a test.
const AGES_AGO = '2026-08-18T10:00:00Z';

// --------------------------------------------------------------------- moved
//
// A tolerance comparison, deliberately NOT a rounded hash. Grid-rounding has a
// boundary: the flip at 29450.76 rounds to 29450 on a 5-point grid, and a
// 2-point drift to 29452.76 rounds to 29455 - so the smallest possible drift
// reads as a change, which is precisely what the rounding was meant to stop.

test('the same levels in a different order have not moved', () => {
  // Build order is not guaranteed to be stable, and a reshuffle is not news.
  assert.deepStrictEqual(N.moved(LEVELS, [...LEVELS].reverse()), []);
});

test('a level drifting two points has not moved', () => {
  // The flip is a computed crossing that drifts continuously with the basis.
  // Treat that as news and the bot posts on every single poll - the exact bug
  // that shipped in the Axion Levels draw gate.
  const drift = LEVELS.map((l) =>
    l.type === 'FLIP' ? { ...l, price: l.price + 2 } : l);
  assert.deepStrictEqual(N.moved(LEVELS, drift), []);
});

test('a wall moving a full strike has moved', () => {
  const next = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  assert.deepStrictEqual(N.moved(LEVELS, next), ['CALL_WALL']);
});

test('a level appearing has moved', () => {
  // London's high does not exist until London closes. Its arrival is real news.
  const next = [...LEVELS,
    { type: 'LONDON_H', price: 30150, label: 'LONDON HIGH 30,150' }];
  assert.deepStrictEqual(N.moved(LEVELS, next), ['LONDON_H']);
});

test('a level disappearing has moved', () => {
  const next = LEVELS.filter((l) => l.type !== 'CALL_WALL');
  assert.deepStrictEqual(N.moved(LEVELS, next), ['CALL_WALL']);
});

test('one of several same-type shelves moving is caught', () => {
  // There are usually six GAMMA_POS/GAMMA_NEG shelves. Matching on type alone
  // would compare the first against the first and miss the rest.
  const many = [
    { type: 'GAMMA_POS', price: 29900 },
    { type: 'GAMMA_POS', price: 30000 },
    { type: 'GAMMA_POS', price: 30200 },
  ];
  const next = [
    { type: 'GAMMA_POS', price: 29900 },
    { type: 'GAMMA_POS', price: 30000 },
    { type: 'GAMMA_POS', price: 30400 },
  ];
  assert.deepStrictEqual(N.moved(many, next), ['GAMMA_POS']);
});

test('shelves reordered but at the same prices have not moved', () => {
  const a = [{ type: 'GAMMA_POS', price: 29900 }, { type: 'GAMMA_POS', price: 30200 }];
  const b = [{ type: 'GAMMA_POS', price: 30200 }, { type: 'GAMMA_POS', price: 29900 }];
  assert.deepStrictEqual(N.moved(a, b), []);
});

test('the same price under a different type has moved', () => {
  // The comparison must not collapse WHICH level a price belongs to.
  const next = LEVELS.map((l) => (l.type === 'PDH' ? { ...l, type: 'ONH' } : l));
  assert.ok(N.moved(LEVELS, next).includes('PDH'));
});

test('having no previous levels counts as moved', () => {
  assert.ok(N.moved(null, LEVELS).length > 0);
});

// ------------------------------------------------------------- session window

test('Saturday is closed', () => {
  assert.strictEqual(N.sessionOpen(new Date('2026-08-15T18:00:00Z')), false);
});

test('Sunday before 18:00 ET is closed, and after it is open', () => {
  // 2026-08-16 is a Sunday. 21:00Z = 17:00 ET, 23:00Z = 19:00 ET.
  assert.strictEqual(N.sessionOpen(new Date('2026-08-16T21:00:00Z')), false);
  assert.strictEqual(N.sessionOpen(new Date('2026-08-16T23:00:00Z')), true);
});

test('Friday after 17:00 ET is closed for the week', () => {
  // 2026-08-14 is a Friday. 22:00Z = 18:00 ET.
  assert.strictEqual(N.sessionOpen(new Date('2026-08-14T22:00:00Z')), false);
});

test('the daily 17:00-18:00 ET maintenance break is closed', () => {
  // Tuesday 21:30Z = 17:30 ET.
  assert.strictEqual(N.sessionOpen(new Date('2026-08-18T21:30:00Z')), false);
});

test('the session boundary uses real daylight saving, not a fixed offset', () => {
  // January is EST (UTC-5), August is EDT (UTC-4). 22:30Z is 17:30 EST in
  // January - the maintenance break - but 18:30 EDT in August, which is open.
  // A hardcoded -240 offset gets every winter session an hour wrong.
  assert.strictEqual(N.sessionOpen(new Date('2026-01-20T22:30:00Z')), false);
  assert.strictEqual(N.sessionOpen(new Date('2026-08-18T22:30:00Z')), true);
});

// -------------------------------------------------------------------- decide

test('nothing moved means nothing is posted', () => {
  const d = N.decide({ levels: LEVELS, state: clean({ lastAt: AGES_AGO }), now: MIDDAY });
  assert.strictEqual(d.post, false);
  assert.match(d.reason, /nothing moved/i);
});

test('a moved wall posts', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({ levels: moved, state: clean({ lastAt: AGES_AGO }), now: MIDDAY });
  assert.strictEqual(d.post, true);
});

test('a second post inside 90 minutes is blocked even though levels moved', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  // 17:00Z is 60 minutes before the 18:00Z "now".
  const d = N.decide({
    levels: moved, now: MIDDAY,
    state: clean({ lastAt: '2026-08-18T17:00:00Z' }),
  });
  assert.strictEqual(d.post, false);
  assert.match(d.reason, /90 min|too soon/i);
});

test('the fourth post of the day is blocked', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({
    levels: moved, now: MIDDAY,
    state: clean({ count: 3, lastAt: AGES_AGO }),
  });
  assert.strictEqual(d.post, false);
  assert.match(d.reason, /cap|3 already/i);
});

test('a new day resets the daily cap', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({
    levels: moved, now: MIDDAY,
    state: clean({ day: '2026-08-17', count: 3, lastAt: AGES_AGO }),
  });
  assert.strictEqual(d.post, true);
});

test('a closed market blocks a post even when levels moved', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({
    levels: moved, state: clean({ lastAt: AGES_AGO }),
    now: new Date('2026-08-15T18:00:00Z'), // Saturday
  });
  assert.strictEqual(d.post, false);
  assert.match(d.reason, /closed/i);
});

test('the morning post goes out even when nothing moved', () => {
  // The daily anchor. Without this, a quiet overnight means the channel gets
  // no post at all and the file nobody re-downloaded looks abandoned.
  const d = N.decide({
    levels: LEVELS, state: clean({ lastAt: AGES_AGO }), now: MIDDAY, morning: true,
  });
  assert.strictEqual(d.post, true);
});

test('the morning post ignores the 90-minute gate and the daily cap', () => {
  const d = N.decide({
    levels: LEVELS, now: MIDDAY, morning: true,
    state: clean({ count: 3, lastAt: '2026-08-18T17:55:00Z' }),
  });
  assert.strictEqual(d.post, true);
});

test('the morning post still respects a closed market', () => {
  // A Saturday cron misfire must not wake anyone up.
  const d = N.decide({
    levels: LEVELS, state: clean({ lastAt: AGES_AGO }), morning: true,
    now: new Date('2026-08-15T18:00:00Z'),
  });
  assert.strictEqual(d.post, false);
});

test('the morning post restarts the daily count at one', () => {
  const d = N.decide({
    levels: LEVELS, now: MIDDAY, morning: true,
    state: clean({ count: 3, lastAt: AGES_AGO }),
  });
  assert.strictEqual(d.nextState.count, 1);
});

test('an intraday post increments the daily count', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({
    levels: moved, now: MIDDAY, state: clean({ count: 1, lastAt: AGES_AGO }),
  });
  assert.strictEqual(d.nextState.count, 2);
});

test('a blocked decision leaves the state untouched', () => {
  // If a skip advanced lastAt, the 90-minute gate would keep re-arming itself
  // on every 30-minute check and a real change could never get through.
  const before = clean({ lastAt: AGES_AGO });
  const d = N.decide({ levels: LEVELS, state: before, now: MIDDAY });
  assert.strictEqual(d.post, false);
  assert.deepStrictEqual(d.nextState, before);
});

test('the very first run ever posts', () => {
  const d = N.decide({ levels: LEVELS, state: null, now: MIDDAY });
  assert.strictEqual(d.post, true);
});

test('a corrupt state file is treated as no state, never thrown on', () => {
  // The state lives in a committed JSON file. A half-written or hand-edited
  // one must degrade to "post", not crash the workflow.
  for (const junk of [undefined, 'nonsense', 42, [], { count: 'three' }]) {
    const d = N.decide({ levels: LEVELS, state: junk, now: MIDDAY });
    assert.strictEqual(d.post, true, `junk state ${JSON.stringify(junk)} should post`);
  }
});

test('a build with no levels never posts', () => {
  // An empty chain fetch must read as a failure, not as "all levels vanished".
  const d = N.decide({ levels: [], state: clean({ lastAt: AGES_AGO }), now: MIDDAY });
  assert.strictEqual(d.post, false);
  assert.match(d.reason, /no levels/i);
});

test('the state records the levels that were actually posted', () => {
  // Not the levels that were merely built. Storing an unposted build would let
  // a change slip past unannounced on the next comparison.
  const next = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({ levels: next, now: MIDDAY, state: clean({ lastAt: AGES_AGO }) });
  assert.deepStrictEqual(N.moved(d.nextState.levels, next), []);
});

test('what changed is named, so the post can say so', () => {
  const moved = LEVELS.map((l) =>
    l.type === 'CALL_WALL' ? { ...l, price: 29760 } : l);
  const d = N.decide({ levels: moved, now: MIDDAY, state: clean({ lastAt: AGES_AGO }) });
  assert.ok(d.changed.includes('CALL_WALL'), 'should name the level that moved');
  assert.ok(!d.changed.includes('PDH'), 'should not name levels that held still');
});
