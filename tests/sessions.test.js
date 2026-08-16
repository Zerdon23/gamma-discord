const test = require('node:test');
const assert = require('node:assert');
const S = require('../sessions.js');

// Bars carry epoch SECONDS. Built by naming a UTC instant whose New York
// wall-clock time is stated in the comment, so each case says what it means.
const T = (iso) => Math.floor(Date.parse(iso) / 1000);

test('nyParts respects US daylight saving', () => {
  // A fixed UTC offset is wrong for half the year, and being an hour out
  // silently folds the last hour of overnight into the RTH high.
  assert.strictEqual(S.nyParts(Date.parse('2026-08-16T12:00:00Z')).hour, 8);  // EDT, UTC-4
  assert.strictEqual(S.nyParts(Date.parse('2026-01-15T12:00:00Z')).hour, 7);  // EST, UTC-5
});

test('nyParts renders midnight as hour 0, not 24', () => {
  assert.strictEqual(S.nyParts(Date.parse('2026-08-16T04:00:00Z')).hour, 0);  // 00:00 EDT
});

test('prior-day RTH high/low come only from 09:30-16:00 New York', () => {
  const bars = [
    { t: T('2026-08-13T13:35:00Z'), h: 100, l: 90, c: 95 },   // 09:35 EDT - RTH
    { t: T('2026-08-13T19:55:00Z'), h: 120, l: 80, c: 110 },  // 15:55 EDT - RTH
    { t: T('2026-08-13T22:00:00Z'), h: 999, l: 1, c: 500 },   // 18:00 EDT - overnight
  ];
  const out = S.sessionLevels(bars, T('2026-08-14T13:00:00Z'));  // 09:00 EDT next day
  assert.strictEqual(out.pdh, 120, 'the 999 overnight spike must not be the prior-day high');
  assert.strictEqual(out.pdl, 80);
});

test('overnight high/low span 18:00 through 09:30 New York', () => {
  const bars = [
    { t: T('2026-08-13T19:55:00Z'), h: 120, l: 80, c: 110 },   // 15:55 EDT - prior RTH
    { t: T('2026-08-13T22:30:00Z'), h: 130, l: 105, c: 125 },  // 18:30 EDT - overnight
    { t: T('2026-08-14T11:00:00Z'), h: 140, l: 100, c: 135 },  // 07:00 EDT - overnight
    { t: T('2026-08-14T14:00:00Z'), h: 200, l: 50, c: 180 },   // 10:00 EDT - today's RTH
  ];
  const out = S.sessionLevels(bars, T('2026-08-14T14:05:00Z'));  // 10:05 EDT
  assert.strictEqual(out.onh, 140);
  assert.strictEqual(out.onl, 100, "today's RTH must not leak into the overnight range");
});

test('an older overnight does not contaminate the current one', () => {
  // Five days of bars are fetched, so every overnight in the window is present.
  // Only the most recent one is the overnight a trader means this morning.
  const bars = [
    { t: T('2026-08-11T23:00:00Z'), h: 900, l: 800, c: 850 },  // 19:00 EDT Mon - old overnight
    { t: T('2026-08-13T22:30:00Z'), h: 130, l: 105, c: 125 },  // 18:30 EDT Wed
    { t: T('2026-08-14T11:00:00Z'), h: 140, l: 100, c: 135 },  // 07:00 EDT Thu
  ];
  const out = S.sessionLevels(bars, T('2026-08-14T13:00:00Z'));  // 09:00 EDT Thu
  assert.strictEqual(out.onh, 140, 'Monday night must not be this morning`s overnight high');
});

test('after the close, the session that just finished is the prior day', () => {
  // Built at 20:00 the levels are for tomorrow, so "prior day" is today's RTH -
  // which has completed. Before 16:00 it must NOT be, because it is still running.
  const bars = [{ t: T('2026-08-14T18:00:00Z'), h: 300, l: 250, c: 280 }];  // 14:00 EDT
  const after = S.sessionLevels(bars, T('2026-08-15T00:00:00Z'));   // 20:00 EDT same day
  assert.strictEqual(after.pdh, 300, 'a completed session counts');
  const during = S.sessionLevels(bars, T('2026-08-14T18:30:00Z'));  // 14:30 EDT, still open
  assert.strictEqual(during.pdh, null, 'an unfinished session is not the prior day');
});

test('missing data yields nulls, never zeroes', () => {
  const out = S.sessionLevels([], T('2026-08-14T14:00:00Z'));
  assert.strictEqual(out.pdh, null);
  assert.strictEqual(out.pdl, null);
  assert.strictEqual(out.onh, null);
  assert.strictEqual(out.onl, null);
});
