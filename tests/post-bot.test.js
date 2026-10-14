/*
 * The bot poster, checked against a fake Discord.
 *
 * This asserts the exact request the real API would reject if we got it wrong:
 * the path, the Authorization scheme, and the multipart field names. Proving
 * the wire format this way needs no token and no live server.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const P = require('../post-bot.js');

const META = {
  builtAt: '2026-08-18T13:24:08.082Z',
  regime: 'positive',
  nqSpot: 29695.38,
  levels: [
    { type: 'CALL_WALL', price: 29710, label: 'CALL WALL 29,710' },
    { type: 'PUT_WALL', price: 29700, label: 'PUT WALL 29,700' },
    { type: 'FLIP', price: 29450.76, label: 'GAMMA FLIP 29,451' },
  ],
};

/** A throwaway Discord that records exactly what it was sent. */
async function fakeDiscord(status = 200, body = '{}') {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('latin1'),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    seen,
    base: `http://127.0.0.1:${server.address().port}/api/v10`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ------------------------------------------------------------------ the wire

test('it posts to the channel messages endpoint', async () => {
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '123456789', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
    });
    assert.strictEqual(d.seen.length, 1);
    assert.strictEqual(d.seen[0].method, 'POST');
    assert.strictEqual(d.seen[0].url, '/api/v10/channels/123456789/messages');
  } finally { await d.close(); }
});

test('the Authorization header uses the Bot scheme', async () => {
  // "Bearer <token>" and a bare token are both 401. Bot tokens are their own
  // scheme, and getting it wrong looks exactly like a bad token.
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
    });
    assert.strictEqual(d.seen[0].headers.authorization, 'Bot tok');
  } finally { await d.close(); }
});

test('the levels file is attached as files[0] alongside payload_json', async () => {
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<levels/>'), morning: true, changed: [],
    });
    const { body, headers } = d.seen[0];
    assert.match(headers['content-type'], /multipart\/form-data/);
    assert.match(body, /name="payload_json"/);
    assert.match(body, /name="files\[0\]"/);
    assert.match(body, /<levels\/>/, 'the file bytes must actually be sent');
  } finally { await d.close(); }
});

test('the attachment is named for the day, not "latest"', async () => {
  // Several days of these end up in one Downloads folder.
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
      now: new Date('2026-08-18T13:00:00Z'),
    });
    assert.match(d.seen[0].body, /filename="NQ-Levels-2026-08-18\.xml"/);
  } finally { await d.close(); }
});

test('it does not send a username override', async () => {
  // Webhooks accept username/avatar_url; bot messages silently ignore them.
  // Sending one implies a display name that will never appear.
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
    });
    assert.doesNotMatch(d.seen[0].body, /"username"/);
  } finally { await d.close(); }
});

// --------------------------------------------------------------- the message

test('the morning message reads as the daily set', () => {
  const m = P.message({ meta: META, morning: true, changed: [] });
  assert.match(m.embeds[0].title, /NQ levels/i);
  assert.doesNotMatch(JSON.stringify(m), /updated/i);
});

test('an update message names what moved, in plain words', () => {
  // "CALL_WALL" is a field name. He reads these on a phone.
  const m = P.message({ meta: META, morning: false, changed: ['CALL_WALL', 'ONH'] });
  const text = JSON.stringify(m);
  assert.match(text, /call wall/i);
  assert.match(text, /overnight high/i);
  assert.doesNotMatch(text, /CALL_WALL/);
});

test('an unrecognised level type still reads as something', () => {
  // A new type added to build-levels.js must not surface as a raw enum or,
  // worse, as "undefined".
  const m = P.message({ meta: META, morning: false, changed: ['NEW_THING'] });
  assert.doesNotMatch(JSON.stringify(m), /undefined/);
});

test('the embed colour follows the gamma regime', () => {
  const pos = P.message({ meta: META, morning: true, changed: [] });
  const neg = P.message({ meta: { ...META, regime: 'negative' }, morning: true, changed: [] });
  assert.notStrictEqual(pos.embeds[0].color, neg.embeds[0].color);
});

test('every level is listed in the message', () => {
  const m = P.message({ meta: META, morning: true, changed: [] });
  for (const l of META.levels) {
    assert.ok(JSON.stringify(m).includes(l.label), `missing ${l.label}`);
  }
});

test('the message carries the not-a-trigger caveat', () => {
  // These levels measurably do not hold better than a random price. The post
  // must not imply otherwise.
  const m = P.message({ meta: META, morning: true, changed: [] });
  assert.match(JSON.stringify(m), /context and targets|not triggers/i);
});

test('a long level list cannot overflow the embed description limit', () => {
  // Discord hard-caps a description at 4096 characters and rejects the whole
  // message if it is exceeded.
  const many = Array.from({ length: 400 }, (_, i) => ({
    type: 'GAMMA_POS', price: 30000 + i, label: `+GAMMA ${30000 + i} · 999m`,
  }));
  const m = P.message({ meta: { ...META, levels: many }, morning: true, changed: [] });
  assert.ok(m.embeds[0].description.length <= 4096,
    `description was ${m.embeds[0].description.length}`);
});

// ------------------------------------------------------------------ failures

test('a Discord error is reported, not thrown', async () => {
  // The levels file is already committed by the time this runs. A failed post
  // is an inconvenience; a failed workflow step looks like a broken build.
  const d = await fakeDiscord(403, '{"message":"Missing Access"}');
  try {
    const r = await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /403/);
  } finally { await d.close(); }
});

test('an unreachable Discord is reported, not thrown', async () => {
  const r = await P.post({
    token: 'tok', channelId: '1', baseUrl: 'http://127.0.0.1:1/api/v10',
    meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
  });
  assert.strictEqual(r.ok, false);
});

test('a missing token or channel is refused before any request', async () => {
  for (const args of [{ token: '', channelId: '1' }, { token: 't', channelId: '' }]) {
    const r = await P.post({
      ...args, meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
      baseUrl: 'http://127.0.0.1:1/api/v10',
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /not configured/i);
  }
});

// ------------------------------------------- the TradingView indicator

test('the indicator rides along as a second attachment', async () => {
  const d = await fakeDiscord();
  try {
    const res = await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<levels/>'),
      pine: '//@version=6\nindicator("x")',
      morning: true, changed: [], now: new Date('2026-08-19T13:00:00Z'),
    });
    assert.strictEqual(res.ok, true);
    const { body } = d.seen[0];
    assert.match(body, /name="files\[0\]"/, 'the DeepCharts file must still be sent');
    assert.match(body, /name="files\[1\]"/, 'the indicator must be sent alongside it');
    assert.match(body, /Goldbach-Gamma-NQ-2026-08-19\.txt/, 'named with the day');
    assert.match(body, /@version=6/, 'and carrying the script itself');
  } finally { await d.close(); }
});

test('without an indicator the request is exactly what it has always been', async () => {
  const d = await fakeDiscord();
  try {
    await P.post({
      token: 'tok', channelId: '1', baseUrl: d.base,
      meta: META, xml: Buffer.from('<x/>'), morning: true, changed: [],
    });
    const { body } = d.seen[0];
    assert.match(body, /name="files\[0\]"/);
    assert.ok(!body.includes('name="files[1]"'), 'no empty second attachment');
  } finally { await d.close(); }
});

test('the morning message tells a first-time reader what to do with it', async () => {
  const m = P.message({ meta: META, morning: true, changed: [], hasPine: true });
  const text = JSON.stringify(m);
  assert.match(text, /Pine Editor/);
  assert.match(text, /grab the new file/i);
});

test('it does not promise an indicator that was not attached', () => {
  const m = P.message({ meta: META, morning: true, changed: [], hasPine: false });
  assert.ok(!JSON.stringify(m).includes('Pine Editor'));
});
