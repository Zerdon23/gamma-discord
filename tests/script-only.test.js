/*
 * The friends' server gets the indicator and nothing else.
 *
 * These exist because the failure they guard is silent and social: a level
 * list posted there is not an error, it just buries the download that people
 * actually came for, and nobody reports it.
 */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../post-bot.js');
const F = require('../friends-update.js');

const META = {
  builtAt: '2026-08-20T12:30:00Z',
  regime: 'positive',
  nqSpot: 29367,
  levels: [{ label: 'CALL_WALL 29500' }, { label: 'PUT_WALL 29000' }],
};

test('a script-only post carries no level prices anywhere in it', () => {
  const m = P.message({ meta: META, morning: true, hasPine: true, scriptOnly: true });
  const blob = JSON.stringify(m);
  assert.ok(!blob.includes('29500'), 'a wall price leaked into the message');
  assert.ok(!blob.includes('29000'), 'a wall price leaked into the message');
  assert.ok(!blob.includes('CALL_WALL'), 'a raw level label leaked in');
});

test('a script-only post carries no gamma fields - they are level data too', () => {
  const m = P.message({ meta: META, morning: true, hasPine: true, scriptOnly: true });
  assert.strictEqual(m.embeds[0].fields, undefined);
});

test('the normal post still lists levels - script-only must not change it', () => {
  const m = P.message({ meta: META, morning: true, hasPine: true });
  assert.ok(JSON.stringify(m).includes('CALL_WALL 29500'));
  assert.strictEqual(m.embeds[0].fields.length, 3);
});

test('script-only sends the indicator as files[0] and no levels file', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = opts.body; return { ok: true }; };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const r = await P.post({
      token: 't', channelId: 'c', meta: META,
      xml: Buffer.from('<xml/>'), pine: Buffer.from('//@version=6'),
      morning: true, scriptOnly: true,
    });
    assert.strictEqual(r.ok, true);
    const names = [...captured.keys()];
    assert.ok(names.includes('files[0]'), 'nothing was attached');
    assert.ok(!names.includes('files[1]'), 'a second file was attached');
    const f0 = captured.get('files[0]');
    assert.ok(f0.type.startsWith('text/plain'), 'files[0] is not the script');
  } finally { globalThis.fetch = realFetch; }
});

test('script-only with no indicator refuses rather than sending an empty post', async () => {
  const r = await P.post({
    token: 't', channelId: 'c', meta: META,
    xml: Buffer.from('<xml/>'), pine: null, morning: true, scriptOnly: true,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no indicator/);
});

test('an intraday run in script-only mode stays quiet', async () => {
  const r = await F.run({
    token: 't', channelId: 'c', morning: false, scriptOnly: true, dry: true,
  });
  assert.strictEqual(r.posted, false);
  assert.match(r.reason, /script only|no levels build/);
});
