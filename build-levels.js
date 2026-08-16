/*
 * Build the daily DeepCharts levels file that anyone can download.
 *
 * Runs on GitHub's scheduler in this repo, so the file appears whether or not
 * any PC is awake. Everything here comes from free public data - a paid
 * subscription key cannot ship inside a public download, so none is used.
 *
 *   node build-levels.js          build and write
 *   node build-levels.js --dry    build and print, write nothing
 */
const fs = require('fs');
const path = require('path');
const cboe = require('./cboe.js');
const sessions = require('./sessions.js');
const annotations = require('./annotations.js');

const OUT_DIR = path.join(__dirname, 'levels');
const SHELVES = 6;          // gamma shelves drawn beyond the two walls
const BASIS_MAX = cboe.BASIS_MAX;

const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const bn = (n) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : `${Math.round(n / 1e6)}m`);
const round2 = (n) => Math.round(n * 100) / 100;

function buildLevels({ gex, basis, sess }) {
  // The basis is what puts index strikes onto an NQ chart. Without it every
  // gamma line is hundreds of points wrong while looking exactly as
  // authoritative as a correct one, so a missing or absurd basis stops the
  // build rather than shipping lines nobody can tell are wrong.
  if (basis === null || basis === undefined || !Number.isFinite(Number(basis))) {
    throw new Error('NQ basis unavailable - refusing to write index prices onto an NQ chart');
  }
  if (Math.abs(basis) > BASIS_MAX) {
    throw new Error(`NQ basis ${basis} is implausible - refusing to build`);
  }

  const nq = (p) => round2(p + basis);
  const levels = [];
  const seen = new Set();

  const push = (type, price, label) => {
    const p = round2(price);
    if (!Number.isFinite(p) || seen.has(p)) return;   // never two lines on one price
    seen.add(p);
    levels.push({ type, price: p, label });
  };

  if (gex.callWall) push('CALL_WALL', nq(gex.callWall), `CALL WALL ${money(nq(gex.callWall))}`);
  if (gex.putWall) push('PUT_WALL', nq(gex.putWall), `PUT WALL ${money(nq(gex.putWall))}`);
  // 0 means "no flip could be priced" - drawing it would put a line at the very
  // bottom of the chart looking like a real level.
  if (gex.flip) push('FLIP', nq(gex.flip), `GAMMA FLIP ${money(nq(gex.flip))}`);

  // Shelves, skipping strikes already drawn as walls: the same price twice
  // reads as one thicker line and spends a label slot saying nothing new.
  const walls = new Set([gex.callWall, gex.putWall]);
  let shelves = 0;
  for (const t of gex.top || []) {
    if (shelves >= SHELVES) break;
    if (walls.has(t.strike)) continue;
    const before = levels.length;
    const positive = t.gex >= 0;
    push(positive ? 'GAMMA_POS' : 'GAMMA_NEG', nq(t.strike),
      `${positive ? '+' : '-'}GAMMA ${money(nq(t.strike))} · ${bn(Math.abs(t.gex))}`);
    if (levels.length > before) shelves++;
  }

  // Session levels are ALREADY NQ prices - they come from NQ=F, not the index.
  const S = sess || {};
  const addSession = (key, type, name) => {
    const v = S[key];
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return;  // absent, not zero
    push(type, v, `${name} ${money(v)}`);
  };
  addSession('pdh', 'PDH', 'PRIOR DAY HIGH');
  addSession('pdl', 'PDL', 'PRIOR DAY LOW');
  addSession('onh', 'ONH', 'OVERNIGHT HIGH');
  addSession('onl', 'ONL', 'OVERNIGHT LOW');

  return {
    levels,
    meta: {
      builtAt: new Date().toISOString(),
      symbol: 'NQ',
      basis,
      indexSpot: round2(gex.spot),
      nqSpot: nq(gex.spot),
      regime: gex.regime,
      netGex: gex.netGex,
      source: 'CBOE delayed chain (_NDX) + Yahoo NQ=F',
      note: 'Context and targets, not triggers. Walls are open-interest based and rebuild overnight.',
    },
  };
}

async function main() {
  const dry = process.argv.includes('--dry');

  const g = await cboe.fetchGex('_NDX');
  if (!g.ok) { console.error(`CBOE: ${g.error}`); process.exit(1); }

  const basis = await cboe.nqBasis(g.data.spot);

  let sess = {};
  try {
    sess = sessions.sessionLevels(await sessions.fetchBars(), Math.floor(Date.now() / 1000));
  } catch (e) {
    // Session levels are a bonus; the gamma structure is the point. Losing
    // Yahoo must not cost the whole file - but it must be loud in the log,
    // because silently thinner output looks identical to a normal day.
    console.error(`Session levels unavailable (${e.message}) - continuing with gamma only`);
  }

  const { levels, meta } = buildLevels({ gex: g.data, basis, sess });
  if (!levels.length) { console.error('No levels built - writing nothing'); process.exit(1); }

  console.log(`${levels.length} levels | basis ${basis} | NQ ~${meta.nqSpot} | ${meta.regime} gamma`);
  for (const l of levels) console.log(`  ${l.label}`);
  if (dry) { console.log('(dry run - nothing written)'); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const text = annotations.serialize(annotations.records(levels, Math.floor(Date.now() / 1000)));
  const day = new Date().toISOString().slice(0, 10);
  const write = (name, body) => {
    const p = path.join(OUT_DIR, name);
    fs.writeFileSync(p + '.tmp', body, 'utf8');
    fs.renameSync(p + '.tmp', p);     // never leave a half-written file readable
  };
  write('NQ-latest.xml', text);
  write(`NQ-${day}.xml`, text);
  write('latest.json', JSON.stringify({ ...meta, levels }, null, 2));
  console.log(`Wrote levels/NQ-latest.xml for ${day}`);
}

module.exports = { buildLevels };
if (require.main === module) main();
