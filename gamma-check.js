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

    // Top strikes by absolute $GEX — the "GEX levels" (biggest gamma concentrations)
    const top = [...net.entries()]
      .map(([k, v]) => ({ strike: k, gex: v * mult }))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
      .slice(0, 6);

    return { ok: true, data: { symbol, spot, callWall: cWall, putWall: pWall, flip, netGex: total, regime: total >= 0 ? 'positive' : 'negative', top } };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out reaching CBOE.' : `Network error: ${e.message}` };
  } finally { clearTimeout(timer); }
}

const fmt = (n) => (!n || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const niceName = (s) => { const x = s.replace(/^_/, ''); return x === 'NDX' ? 'NDX (Nasdaq)' : x; };

// $ gamma exposure in a compact, signed form: +$1.24bn / -$930m
function fmtGex(n) {
  if (!n || !isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}m`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

function topStrikesText(top) {
  if (!top || !top.length) return '—';
  // 🔴 = call-heavy (positive GEX), 🟢 = put-heavy (negative GEX)
  return top.map(t => `${t.gex >= 0 ? '🔴' : '🟢'} ${fmt(t.strike)} · ${fmtGex(t.gex)}`).join('\n');
}

// Build a Pine Script (v5) that draws the current gamma levels on a TradingView chart.
// User pastes it into TradingView → Pine Editor → Add to chart.
function buildPine(cur) {
  const day = new Date().toISOString().slice(0, 10);
  const sym = niceName(cur.symbol);
  const gexOf = {}; (cur.top || []).forEach(t => { gexOf[t.strike] = t.gex; });
  const extras = (cur.top || []).filter(t => t.strike !== cur.callWall && t.strike !== cur.putWall).slice(0, 4);

  const L = [];
  L.push('//@version=5');
  L.push(`indicator("Gamma Levels ${sym} (${day})", overlay=true, max_labels_count=50)`);
  L.push('offset = input.float(0.0, "Price offset — set to about +250 if your chart is NQ futures, else 0")');
  L.push('showExtra = input.bool(true, "Show other big gamma strikes")');
  L.push('');
  L.push('// --- Main levels ---');
  L.push(`plot(${cur.callWall} + offset, "Call Wall", color=color.new(color.red, 0), linewidth=3)`);
  L.push(`plot(${cur.putWall} + offset, "Put Wall", color=color.new(color.green, 0), linewidth=3)`);
  if (cur.flip) L.push(`plot(${cur.flip} + offset, "Gamma Flip", color=color.new(color.yellow, 0), linewidth=2)`);
  if (extras.length) {
    L.push('');
    L.push('// --- Other big gamma strikes ---');
    extras.forEach(t => {
      const col = t.gex >= 0 ? 'color.new(color.red, 45)' : 'color.new(color.green, 45)';
      L.push(`plot(showExtra ? ${t.strike} + offset : na, "Strike ${fmt(t.strike)}", color=${col}, linewidth=1)`);
    });
  }
  L.push('');
  L.push('// --- Labels on the latest bar ---');
  L.push('if barstate.islast');
  L.push(`    label.new(bar_index, ${cur.callWall} + offset, "Call Wall ${fmt(cur.callWall)}  ${fmtGex(gexOf[cur.callWall])}", style=label.style_label_left, color=color.new(color.red, 0), textcolor=color.white, size=size.small)`);
  L.push(`    label.new(bar_index, ${cur.putWall} + offset, "Put Wall ${fmt(cur.putWall)}  ${fmtGex(gexOf[cur.putWall])}", style=label.style_label_left, color=color.new(color.green, 0), textcolor=color.white, size=size.small)`);
  if (cur.flip) L.push(`    label.new(bar_index, ${cur.flip} + offset, "Gamma Flip ${fmt(cur.flip)}", style=label.style_label_left, color=color.new(color.orange, 0), textcolor=color.white, size=size.small)`);
  return L.join('\n') + '\n';
}

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
        { name: 'Net GEX', value: `${fmtGex(cur.netGex)} · ${pos ? 'positive 🟩' : 'negative 🟥'}`, inline: true },
        { name: 'Spot (≈15m delayed)', value: fmt(cur.spot), inline: true },
        { name: '​', value: '​', inline: true },
        { name: 'Top gamma strikes ($GEX)', value: topStrikesText(cur.top), inline: false },
        { name: '📈 Draw these on TradingView', value: 'Open the attached file below → copy all of it → in TradingView open the **Pine Editor** (bottom) → paste → **Add to chart**.', inline: false }
      ],
      footer: { text: 'CBOE free delayed data · walls update overnight · 🔴 call-heavy 🟢 put-heavy' },
      timestamp: new Date().toISOString()
    }]
  };
}

const changed = (c, p) => !p || c.callWall !== p.callWall || c.putWall !== p.putWall || c.flip !== p.flip;

(async () => {
  const DRY = process.env.DRY === '1';
  if (!WEBHOOK && !DRY) { console.error('DISCORD_WEBHOOK not set.'); process.exit(1); }
  const r = await fetchGex(SYMBOL);
  if (!r.ok) { console.error('Fetch error:', r.error); process.exit(0); } // don't fail the run; try again next time
  const cur = r.data;
  console.log(`${cur.symbol}: Call ${fmt(cur.callWall)} | Put ${fmt(cur.putWall)} | Flip ${fmt(cur.flip)} | ${cur.regime} | spot ${fmt(cur.spot)}`);
  if (DRY) {
    console.log('\n--- Discord message preview ---\n' + JSON.stringify(buildMessage(cur, null), null, 2));
    console.log('\n--- TradingView Pine file preview ---\n' + buildPine(cur));
    return;
  }

  const state = loadState();
  const prev = state[SYMBOL];
  if (!changed(cur, prev)) { console.log('No change.'); return; }

  // Post the embed AND attach the TradingView Pine file (multipart)
  const form = new FormData();
  form.append('payload_json', JSON.stringify(buildMessage(cur, prev)));
  const fname = `Gamma-Levels-${cur.symbol.replace(/^_/, '')}-${new Date().toISOString().slice(0, 10)}.txt`;
  form.append('files[0]', new Blob([buildPine(cur)], { type: 'text/plain' }), fname);
  const res = await fetch(WEBHOOK, { method: 'POST', body: form });
  if (!res.ok) { console.error(`Discord post failed HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); process.exit(0); }
  console.log('Posted to Discord (with TradingView file).');
  state[SYMBOL] = { callWall: cur.callWall, putWall: cur.putWall, flip: cur.flip, at: new Date().toISOString() };
  saveState(state);
})();
