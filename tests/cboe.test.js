/*
 * The fixture is a REAL CBOE payload captured live on 2026-08-16, trimmed to
 * the four fields the math reads. A hand-authored fixture would test our idea
 * of the API rather than the API.
 *
 * Nothing here asserts a specific flip or wall PRICE. The fixture's expiries
 * recede as time passes, so a pinned number would rot into a false failure;
 * what is asserted is shape and ordering, which do not.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cboe = require('../cboe.js');

const BODY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cboe-ndx.json'), 'utf8'));

test('parseGex returns walls and a regime from a real payload', () => {
  const d = cboe.parseGex(BODY);
  assert.ok(d.spot > 1000, 'spot should be an index price');
  assert.ok(d.callWall > 0 && d.putWall > 0);
  assert.notStrictEqual(d.callWall, d.putWall, 'walls must be distinct strikes');
  assert.ok(d.callWall > d.putWall, 'the call wall sits above the put wall');
  assert.ok(Array.isArray(d.top) && d.top.length > 0);
  assert.ok(d.top.every((t) => typeof t.strike === 'number' && typeof t.gex === 'number'));
  assert.ok(['positive', 'negative'].includes(d.regime));
  assert.strictEqual(d.regime, d.netGex >= 0 ? 'positive' : 'negative');
});

test('top strikes are sorted by absolute gamma, biggest first', () => {
  const { top } = cboe.parseGex(BODY);
  for (let i = 1; i < top.length; i++) {
    assert.ok(Math.abs(top[i - 1].gex) >= Math.abs(top[i].gex), 'top must be ordered');
  }
});

test('the walls really are the extremes of the book', () => {
  // Checked against an INDEPENDENT reimplementation, not against parseGex's own
  // `top` list - `top` is ranked by ABSOLUTE gamma, so in a lopsided book the
  // call wall can legitimately fall outside it and the check would be circular
  // as well as flaky.
  const OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
  const net = new Map();
  for (const o of BODY.data.options) {
    const m = OCC.exec(o.option || '');
    if (!m) continue;
    const g = Number(o.gamma) || 0, oi = Number(o.open_interest) || 0;
    if (!g || !oi) continue;
    const k = Number(m[4]) / 1000;
    net.set(k, (net.get(k) || 0) + (m[3] === 'P' ? -g * oi : g * oi));
  }
  let hiK = 0, loK = 0, hi = -Infinity, lo = Infinity;
  for (const [k, v] of net) {
    if (v > hi) { hi = v; hiK = k; }
    if (v < lo) { lo = v; loK = k; }
  }
  const d = cboe.parseGex(BODY);
  assert.strictEqual(d.callWall, hiK);
  assert.strictEqual(d.putWall, loK);
});

test('a payload with no usable gamma throws rather than returning zeroes', () => {
  // A file of zeroes drawn on a live chart is worse than no file at all.
  assert.throws(() => cboe.parseGex({ data: { current_price: 30000, options: [] } }),
    /no usable gamma/i);
});

test('a payload with no spot throws', () => {
  assert.throws(() => cboe.parseGex({ data: { options: [{ option: 'NDX260821C00030000', gamma: 1, open_interest: 1 }] } }),
    /spot/i);
});

test('a malformed payload throws', () => {
  assert.throws(() => cboe.parseGex({ data: {} }), /unexpected/i);
  assert.throws(() => cboe.parseGex(null), /unexpected/i);
});

test('puts push the book negative and calls push it positive', () => {
  // The sign convention is the whole basis of "call wall" vs "put wall". Get it
  // backwards and every level is drawn on the wrong side, with no error.
  const one = (cp) => ({ data: { current_price: 30000,
    options: [{ option: `NDX260821${cp}00030000`, gamma: 0.001, open_interest: 500, iv: 0.2 }] } });
  assert.ok(cboe.parseGex(one('C')).netGex > 0, 'a lone call must be positive gamma');
  assert.ok(cboe.parseGex(one('P')).netGex < 0, 'a lone put must be negative gamma');
});
