/*
 * CBOE delayed-chain gamma, extracted so the levels file can reuse it.
 *
 * The chain math here was copied verbatim from gamma-check.js, the 15-minute
 * Discord poster this repo used to run. That file was an IIFE which fired on
 * import, so it could never be required - hence the copy. It was deleted on
 * 2026-08-16 once the daily levels post replaced it; git history has it.
 * The flip was never copied - gammaflip.js is a module and is required.
 *
 * The endpoint is free and needs no key, which is the whole reason a shareable
 * download can exist at all: a paid subscription key cannot ship inside a public
 * app.
 */
const GF = require('./gammaflip.js');

const OCC_RX = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
// CBOE 403s a request that does not look like a browser. This is not optional.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

const TOP_N = 12;
// A plausible NDX->NQ gap. Measured live at +96 on 2026-08-16; it drifts with
// rates and time to expiry, and jumps at each quarterly roll, so it is measured
// every run rather than hardcoded - but a value outside this bound means
// something upstream is wrong, not that the basis moved.
const BASIS_MAX = 2000;

/*
 * Net gamma per strike: gamma x open interest, with puts negated. Scaled to
 * dollars per 1% move by 100 (contract multiplier) x spot^2 x 0.01.
 *
 * Takes an already-parsed body rather than fetching, so the whole reduction is
 * testable offline against a captured payload.
 */
function parseGex(body) {
  const data = body && body.data;
  if (!data || !Array.isArray(data.options)) throw new Error('Unexpected CBOE response shape');

  const spot = Number(data.current_price) || Number(data.close) || 0;
  if (!spot) throw new Error('Unexpected CBOE response: no spot price');

  const net = new Map();
  for (const o of data.options) {
    const m = OCC_RX.exec((o && o.option) || '');
    if (!m) continue;
    const gamma = Number(o.gamma) || 0;
    const oi = Number(o.open_interest) || 0;
    // A contract with no gamma or no open interest contributes nothing. Skipped,
    // never coerced to zero and counted.
    if (gamma === 0 || oi === 0) continue;
    const strike = Number(m[4]) / 1000;
    const signed = m[3] === 'P' ? -(gamma * oi) : gamma * oi;
    net.set(strike, (net.get(strike) || 0) + signed);
  }
  if (net.size === 0) throw new Error('No usable gamma in payload');

  const mult = 100 * spot * spot * 0.01;
  let callWall = 0, putWall = 0, best = -Infinity, worst = Infinity, total = 0;
  const top = [];
  for (const [strike, v] of net) {
    const gex = v * mult;
    total += gex;
    if (gex > best) { best = gex; callWall = strike; }
    if (gex < worst) { worst = gex; putWall = strike; }
    top.push({ strike, gex });
  }
  // Ranked by ABSOLUTE gamma - the biggest concentrations, either side.
  top.sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));

  // 0 means "no flip could be priced". build-levels.js checks for it and draws
  // nothing rather than putting a line at price zero.
  const flip = GF.zeroGamma(GF.parseChain(body), spot) || 0;

  return {
    spot, callWall, putWall, flip,
    netGex: total,
    regime: total >= 0 ? 'positive' : 'negative',
    top: top.slice(0, TOP_N),
  };
}

async function fetchGex(symbol) {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `CBOE HTTP ${res.status}` };
    return { ok: true, data: parseGex(await res.json()) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * NDX is an index; NQ is a future on the same index. The gap between them is
 * ADDITIVE, not a ratio - so every strike is shifted by one integer rather than
 * scaled. Returns null when it cannot be measured, and the caller must refuse to
 * build rather than fall back to index prices.
 */
async function nqBasis(ndxSpot) {
  if (!ndxSpot) return null;
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/NQ=F?interval=1d&range=1d',
      { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const j = await res.json();
    const px = j && j.chart && j.chart.result && j.chart.result[0]
      && j.chart.result[0].meta && j.chart.result[0].meta.regularMarketPrice;
    if (!px) return null;
    const basis = Math.round(px - ndxSpot);
    return Math.abs(basis) > BASIS_MAX ? null : basis;
  } catch {
    return null;
  }
}

module.exports = { parseGex, fetchGex, nqBasis, BASIS_MAX };
