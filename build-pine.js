/*
 * Write the TradingView indicator for today.
 *
 *   node build-pine.js
 *
 * Reads the levels build that build-levels.js has already written. Writes two
 * copies: a stable name a link can point at, and a dated archive so a bad
 * morning can be looked at afterwards instead of argued about.
 *
 * Deliberately a separate entry point from build-levels.js. That one fetches
 * from CBOE and can fail on the network; this one is pure text and cannot.
 * Keeping them apart means a change to the indicator can never break the file
 * the DeepCharts injector downloads.
 */
const fs = require('node:fs');
const path = require('node:path');
const pine = require('./pine.js');

function run({ root = __dirname } = {}) {
  const metaPath = path.join(root, 'levels', 'latest.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`no levels/latest.json under ${root} - run build-levels.js first`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  /*
   * Refuse a build from before the stale-basis fix.
   *
   * build-levels.js has written `basisSource` since the 2026-08-18 fix that
   * stopped publishing levels built on a stale index/futures pairing. A file
   * without it was written by the older code, and the one sitting in this repo
   * when this was built carried basis -300 - which tests/basis.test.js records
   * as roughly 395 points wrong.
   *
   * That file produces a perfectly well-formed script full of wrong walls, and
   * a wrong level looks exactly as authoritative as a right one. Same rule
   * build-levels.js already applies to itself, applied to the new output.
   */
  if (!meta.basisSource) {
    throw new Error(
      'levels/latest.json has no basisSource - it predates the stale-basis fix. '
      + 'Run build-levels.js to produce a current build before writing an indicator.',
    );
  }

  const src = pine.build(meta);
  const day = String(meta.builtAt).slice(0, 10);

  const dir = path.join(root, 'tradingview');
  fs.mkdirSync(dir, { recursive: true });

  const stable = path.join(dir, 'Goldbach-Gamma-NQ.txt');
  const dated = path.join(dir, `Goldbach-Gamma-NQ-${day}.txt`);
  fs.writeFileSync(stable, src);
  fs.writeFileSync(dated, src);

  return { written: [stable, dated], day };
}

if (require.main === module) {
  try {
    const out = run({});
    console.log(`indicator written for ${out.day}`);
    for (const f of out.written) console.log(`  ${path.basename(f)}`);
  } catch (e) {
    // A sentence, not a stack. Someone reading a failed Actions run needs to
    // know what to do, and exit 1 stops the workflow attaching a file that
    // was never written.
    console.error(`No indicator written: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { run };
