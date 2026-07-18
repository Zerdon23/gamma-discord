/*
 * Gamma Levels -> Discord — CLOUD single-run checker (runs on GitHub's scheduler).
 * Zero dependencies. Fetches CBOE's free delayed chain, computes Call/Put Wall + Flip,
 * and posts to Discord (webhook in the DISCORD_WEBHOOK env secret) ONLY when they change.
 * Last-posted levels are kept in state.json, which the workflow commits back to the repo.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');
const SYMBOL = (process.env.SYMBOL || '_NDX').trim();
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

/* ---- GEX from CBOE (same math as the Gamma Overlay) ---- */
const OCC_RX = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;

async function fetchGex(symbol) {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `CBOE HTTP ${res.status}` };
    const body = await res.json();
    const data = body && body.data;
    if (!data || !Array.isArray(data.options)) return { ok: false, error: 'Unexpected CBOE response.' };

    const spot = Number(data.current_price) || Number(data.close) || 0;
    const net = new Map();
    for (const o of data.options) {
      const m = OCC_RX.exec(o.option || '');
      if (!m) continue;
      const gamma = Number(o.gamma) || 0, oi = Number(o.open_interest) || 0;
      if (gamma === 0 || oi === 0) continue;
      const strike = Number(m[4]) / 1000;
      let v = gamma * oi; if (m[3] === 'P') v = -v;
      net.set(strike, (net.get(strike) || 0) + v);
    }
    if (net.size === 0) return { ok: false, error: 'No usable gamma.' };

    const mult = 100 * spot * spot * 0.01;
    const strikes = [...net.keys()].sort((a, b) => a - b);
    let cum = 0, prev = 0, flip = 0, fd = Infinity, first = true;
    for (const k of strikes) {
      cum += net.get(k) * mult;
      if (!first && ((prev < 0 && cum >= 0) || (prev >= 0 && cum < 0)) && Math.abs(k - spot) < fd) { fd = Math.abs(k - spot); flip = k; }
      prev = cum; first = false;
    }
    let cWall = 0, pWall = 0, cB = -Infinity, pB = Infinity;
    for (const [k, v] of net) { if (v > cB) { cB = v; cWall = k; } if (v < pB) { pB = v; pWall = k; } }
    const lo = Math.min(cWall, pWall), hi = Math.max(cWall, pWall);
    if (!(flip > lo && flip < hi)) flip = 0;
    let total = 0; for (const v of net.values()) total += v * mult;

    return { ok: true, data: { symbol, spot, callWall: cWall, putWall: pWall, flip, regime: total >= 0 ? 'positive' : 'negative' } };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out reaching CBOE.' : `Network error: ${e.message}` };
  } finally { clearTimeout(timer); }
}

const fmt = (n) => (!n || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const niceName = (s) => { const x = s.replace(/^_/, ''); return x === 'NDX' ? 'NDX (Nasdaq)' : x; };

function buildMessage(cur, prev) {
  const green = 0x3ba776, red = 0xe05a5a, pos = cur.regime === 'positive';
  const ch = [];
  if (prev && prev.callWall && prev.callWall !== cur.callWall) ch.push(`Call Wall ${fmt(prev.callWall)} → ${fmt(cur.callWall)}`);
  if (prev && prev.putWall && prev.putWall !== cur.putWall) ch.push(`Put Wall ${fmt(prev.putWall)} → ${fmt(cur.putWall)}`);
  if (prev && prev.flip !== cur.flip) ch.push(`Flip ${fmt(prev.flip)} → ${fmt(cur.flip)}`);
  return {
    username: 'Gamma Levels',
    embeds: [{
      title: `📊 ${niceName(cur.symbol)} — Gamma Levels Updated`,
      description: ch.length ? ch.join('\n') : 'New levels for today.',
      color: pos ? green : red,
      fields: [
        { name: '🔴 Call Wall', value: fmt(cur.callWall), inline: true },
        { name: '🟢 Put Wall', value: fmt(cur.putWall), inline: true },
        { name: '🟡 Gamma Flip', value: fmt(cur.flip), inline: true },
        { name: 'Regime', value: pos ? 'Positive gamma 🟩' : 'Negative gamma 🟥', inline: true },
        { name: 'Spot (≈15m delayed)', value: fmt(cur.spot), inline: true }
      ],
      footer: { text: 'CBOE free delayed data · walls update overnight' },
      timestamp: new Date().toISOString()
    }]
  };
}

const changed = (c, p) => !p || c.callWall !== p.callWall || c.putWall !== p.putWall || c.flip !== p.flip;

(async () => {
  if (!WEBHOOK) { console.error('DISCORD_WEBHOOK not set.'); process.exit(1); }
  const r = await fetchGex(SYMBOL);
  if (!r.ok) { console.error('Fetch error:', r.error); process.exit(0); } // don't fail the run; try again next time
  const cur = r.data;
  console.log(`${cur.symbol}: Call ${fmt(cur.callWall)} | Put ${fmt(cur.putWall)} | Flip ${fmt(cur.flip)} | ${cur.regime} | spot ${fmt(cur.spot)}`);

  const state = loadState();
  const prev = state[SYMBOL];
  if (!changed(cur, prev)) { console.log('No change.'); return; }

  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildMessage(cur, prev)) });
  if (!res.ok) { console.error(`Discord post failed HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); process.exit(0); }
  console.log('Posted to Discord.');
  state[SYMBOL] = { callWall: cur.callWall, putWall: cur.putWall, flip: cur.flip, at: new Date().toISOString() };
  saveState(state);
})();
