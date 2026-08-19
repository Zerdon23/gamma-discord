/*
 * Writing the indicator to disk.
 *
 * The stable name is what a link points at; the dated copy is what makes a
 * bad morning diagnosable afterwards. Both, every time.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../build-pine.js');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-'));
  fs.mkdirSync(path.join(root, 'levels'));
  fs.copyFileSync(
    path.join(__dirname, 'fixtures', 'latest-sample.json'),
    path.join(root, 'levels', 'latest.json'),
  );
  return root;
}

test('it writes the stable name and a dated archive', () => {
  const root = scratch();
  const out = B.run({ root });
  assert.strictEqual(out.day, '2026-08-19');
  const stable = path.join(root, 'tradingview', 'Goldbach-Gamma-NQ.txt');
  const dated = path.join(root, 'tradingview', 'Goldbach-Gamma-NQ-2026-08-19.txt');
  assert.ok(fs.existsSync(stable), 'stable file missing');
  assert.ok(fs.existsSync(dated), 'dated archive missing');
  assert.strictEqual(fs.readFileSync(stable, 'utf8'), fs.readFileSync(dated, 'utf8'));
});

test('the written file is the generated script', () => {
  const root = scratch();
  B.run({ root });
  const txt = fs.readFileSync(path.join(root, 'tradingview', 'Goldbach-Gamma-NQ.txt'), 'utf8');
  assert.ok(txt.startsWith('//@version=6'));
  assert.ok(txt.includes('29900'));
});

test('rerunning the same morning overwrites rather than piling up', () => {
  const root = scratch();
  B.run({ root });
  B.run({ root });
  const files = fs.readdirSync(path.join(root, 'tradingview'));
  assert.strictEqual(files.length, 2, `expected 2 files, got ${files.join(', ')}`);
});

test('no levels build means nothing is written, and it says so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-'));
  assert.throws(() => B.run({ root }), /latest\.json/);
});

test('a build from before the stale-basis fix is refused', () => {
  // The real levels/latest.json in this repo on 2026-08-19 carried basis -300
  // and no basisSource - roughly 395 points wrong, per tests/basis.test.js. It
  // generates a flawless-looking script full of wrong walls, so it is refused
  // rather than published.
  const root = scratch();
  const p = path.join(root, 'levels', 'latest.json');
  const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete meta.basisSource;
  meta.basis = -300;
  fs.writeFileSync(p, JSON.stringify(meta));
  assert.throws(() => B.run({ root }), /basisSource/);
  assert.ok(!fs.existsSync(path.join(root, 'tradingview')), 'nothing may be written');
});
