/*
 * The runner: read the build, decide, post, remember.
 *
 * The line worth testing here is when the state gets written. If a failed post
 * still marked the change as announced, that change would never be announced -
 * it would look identical to "nothing moved" on every later check, and the
 * channel would silently go quiet for the rest of the day.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const R = require('../friends-update.js');

const LEVELS = [
  { type: 'CALL_WALL', price: 29710, label: 'CALL WALL 29,710' },
  { type: 'FLIP', price: 29450.76, label: 'GAMMA FLIP 29,451' },
];
const MIDDAY = new Date('2026-08-18T18:00:00Z'); // Tuesday, mid-session

function workspace(levels = LEVELS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friends-'));
  fs.mkdirSync(path.join(dir, 'levels'));
  fs.writeFileSync(path.join(dir, 'levels', 'latest.json'), JSON.stringify({
    builtAt: '2026-08-18T13:24:08.082Z', regime: 'positive', nqSpot: 29695, levels,
  }));
  fs.writeFileSync(path.join(dir, 'levels', 'NQ-latest.xml'), '<levels/>');
  return {
    dir,
    statePath: path.join(dir, 'state', 'friends.json'),
    state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state', 'friends.json'), 'utf8')),
    hasState: () => fs.existsSync(path.join(dir, 'state', 'friends.json')),
  };
}

async function fakeDiscord(status = 200) {
  let hits = 0;
  // Keeps the body as well as the count - latin1 so multipart bytes survive
  // intact, the same way tests/post-bot.test.js reads them.
  const seen = [];
  const server = http.createServer((req, res) => {
    hits += 1;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ body: Buffer.concat(chunks).toString('latin1') });
      res.writeHead(status, { 'content-type': 'application/json' }); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    hits: () => hits,
    seen,
    base: `http://127.0.0.1:${server.address().port}/api/v10`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const run = (w, d, over = {}) => R.run({
  root: w.dir, token: 'tok', channelId: '1', baseUrl: d.base,
  now: MIDDAY, morning: true, ...over,
});

test('a successful post writes the state', async () => {
  const w = workspace(); const d = await fakeDiscord();
  try {
    const r = await run(w, d);
    assert.strictEqual(r.posted, true);
    assert.strictEqual(d.hits(), 1);
    assert.strictEqual(w.state().levels.length, LEVELS.length);
  } finally { await d.close(); }
});

test('a FAILED post does not write the state', async () => {
  // Otherwise the change is recorded as announced when nobody saw it, and the
  // next check reads "nothing moved" - the post is lost, silently, forever.
  const w = workspace(); const d = await fakeDiscord(403);
  try {
    const r = await run(w, d);
    assert.strictEqual(r.posted, false);
    assert.strictEqual(w.hasState(), false, 'state must not exist after a failed post');
  } finally { await d.close(); }
});

test('a retry after a failed post still announces the change', async () => {
  // The consequence of the rule above, end to end.
  const w = workspace(); const bad = await fakeDiscord(500);
  try { await run(w, bad); } finally { await bad.close(); }
  const good = await fakeDiscord(200);
  try {
    const r = await run(w, good, { morning: false });
    assert.strictEqual(r.posted, true, 'the change must survive the failure');
  } finally { await good.close(); }
});

test('a skip posts nothing and writes nothing', async () => {
  const w = workspace(); const d = await fakeDiscord();
  try {
    await run(w, d);                                   // morning post
    const before = JSON.stringify(w.state());
    const r = await run(w, d, { morning: false });     // nothing has moved
    assert.strictEqual(r.posted, false);
    assert.match(r.reason, /nothing moved/i);
    assert.strictEqual(d.hits(), 1, 'no second request');
    assert.strictEqual(JSON.stringify(w.state()), before, 'state untouched');
  } finally { await d.close(); }
});

test('a dry run decides but sends nothing', async () => {
  const w = workspace(); const d = await fakeDiscord();
  try {
    const r = await run(w, d, { dry: true });
    assert.strictEqual(d.hits(), 0);
    assert.strictEqual(w.hasState(), false);
    assert.ok(r.reason);
  } finally { await d.close(); }
});

test('a missing build is reported, not thrown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  const r = await R.run({
    root: dir, token: 'tok', channelId: '1', now: MIDDAY, morning: true,
    baseUrl: 'http://127.0.0.1:1/api/v10',
  });
  assert.strictEqual(r.posted, false);
  assert.match(r.reason, /no levels|build/i);
});

test('a corrupt state file does not stop the post', async () => {
  const w = workspace(); const d = await fakeDiscord();
  try {
    fs.mkdirSync(path.dirname(w.statePath), { recursive: true });
    fs.writeFileSync(w.statePath, '{ this is not json');
    const r = await run(w, d, { morning: false });
    assert.strictEqual(r.posted, true, 'unreadable history means treat it as new');
  } finally { await d.close(); }
});

test('an unconfigured bot is a clean no-op, not a crash', async () => {
  // Before the token secret is set, every scheduled run hits this path.
  const w = workspace();
  const r = await R.run({
    root: w.dir, token: '', channelId: '', now: MIDDAY, morning: true,
    baseUrl: 'http://127.0.0.1:1/api/v10',
  });
  assert.strictEqual(r.posted, false);
  assert.match(r.reason, /not configured/i);
  assert.strictEqual(w.hasState(), false);
});

// ------------------------------------------- the TradingView indicator

test('the morning run attaches the indicator when it has been built', async () => {
  const w = workspace(); const d = await fakeDiscord();
  try {
    fs.mkdirSync(path.join(w.dir, 'tradingview'));
    fs.writeFileSync(path.join(w.dir, 'tradingview', 'Goldbach-Gamma-NQ.txt'),
      '//@version=6\nindicator("x")');
    const r = await run(w, d);
    assert.strictEqual(r.posted, true);
    assert.match(d.seen[0].body, /name="files\[1\]"/, 'indicator not attached');
    assert.match(d.seen[0].body, /@version=6/);
  } finally { await d.close(); }
});

test('a missing indicator does not stop the levels going out', async () => {
  // The indicator is an extra on top of the levels. If build-pine.js has not
  // run, the crew still get their levels rather than nothing at all.
  const w = workspace(); const d = await fakeDiscord();
  try {
    const r = await run(w, d);
    assert.strictEqual(r.posted, true);
    assert.ok(!d.seen[0].body.includes('name="files[1]"'));
  } finally { await d.close(); }
});

test('an intraday change post carries no indicator', async () => {
  // The file is a once-a-morning artifact. Re-attaching this morning's copy to
  // a 2pm "the flip moved" post invites someone to paste a script whose walls
  // the same message is telling them have changed.
  const w = workspace(); const d = await fakeDiscord();
  try {
    fs.mkdirSync(path.join(w.dir, 'tradingview'));
    fs.writeFileSync(path.join(w.dir, 'tradingview', 'Goldbach-Gamma-NQ.txt'), '//@version=6');
    const r = await run(w, d, { morning: false });
    assert.strictEqual(r.posted, true);
    assert.ok(!d.seen[0].body.includes('name="files[1]"'));
  } finally { await d.close(); }
});
