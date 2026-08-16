// gammaflip.js — repriced zero-gamma ("gamma flip") engine. Zero dependencies.
//
// CANONICAL COPY. Identical copies live in:
//     gamma-discord/gammaflip.js
//     gamma-discord-cloud/gammaflip.js
// Keep them in sync; gamma-discord-cloud is its own repo and cannot import.
//
// WHY THIS EXISTS
// The old flip walked the strikes low->high, cumulating each strike's gamma as a
// FIXED number, and reported the strike where the running total changed sign.
// Gamma is not fixed: it moves as spot moves. Measured on the live NDX chain the
// old method said 29360 where the correct answer is 28672 — about 690 points out.
//
// The correct question is "at what price would dealers' net gamma be zero?", and
// answering it means RE-PRICING every option's gamma at each candidate price.
// That is what this does.
//
// It also deliberately does NOT gate the answer on sitting between the call and
// put walls. That gate used to exist to suppress the old method's noise, but the
// flip genuinely can sit outside both walls (it did on NDX: walls 27000/28550,
// flip 28672) and the gate silently reported "no flip" instead.

"use strict";

const SQRT2PI = Math.sqrt(2 * Math.PI);
const npdf = (x) => Math.exp(-x * x / 2) / SQRT2PI;

// Black-Scholes gamma. Returns 0 rather than NaN for expired/degenerate inputs so
// a single bad contract in a 6000-line chain cannot poison the whole sum.
function bsGamma(S, K, T, sigma, r = 0.04) {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return 0;
  const vt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / vt;
  const g = npdf(d1) / (S * vt);
  return isFinite(g) ? g : 0;
}

// Dealer net gamma exposure if spot were S, in dollars per 1% move.
// Convention: long calls / short puts (the standard retail-facing assumption).
// options: [{ K, cp:'C'|'P', T (years), iv (decimal), oi }]
function netGammaAt(S, options) {
  let sum = 0;
  for (const o of options) {
    if (!o || !(o.oi > 0)) continue;
    const g = bsGamma(S, o.K, o.T, o.iv);
    if (!g) continue;
    sum += g * o.oi * (o.cp === "C" ? 1 : -1);
  }
  return sum * 100 * S * S * 0.01;
}

// The flip: the price at which netGammaAt crosses zero.
// Coarse scan to bracket a sign change, then bisect for precision.
// Returns the crossing nearest to spot, or null if the book never changes sign.
function zeroGamma(options, spot, opts = {}) {
  const valid = (options || []).filter((o) => o && o.oi > 0 && o.iv > 0 && o.T > 0 && o.K > 0);
  if (!valid.length || !(spot > 0)) return null;

  const lo = (opts.lo != null) ? opts.lo : spot * 0.75;
  const hi = (opts.hi != null) ? opts.hi : spot * 1.25;
  const steps = opts.steps || 240;
  const dx = (hi - lo) / steps;

  const brackets = [];
  let prevX = lo, prevG = netGammaAt(lo, valid);
  for (let i = 1; i <= steps; i++) {
    const x = lo + i * dx;
    const g = netGammaAt(x, valid);
    if (prevG !== 0 && g !== 0 && (prevG < 0) !== (g < 0)) brackets.push([prevX, prevG, x, g]);
    prevX = x; prevG = g;
  }
  if (!brackets.length) return null;

  // bisect each bracket to ~0.01 price precision
  const roots = brackets.map(([a, ga, b, gb]) => {
    let x0 = a, g0 = ga, x1 = b, g1 = gb;
    for (let i = 0; i < 60 && (x1 - x0) > 0.01; i++) {
      const mid = (x0 + x1) / 2;
      const gm = netGammaAt(mid, valid);
      if (gm === 0) return mid;
      if ((g0 < 0) !== (gm < 0)) { x1 = mid; g1 = gm; } else { x0 = mid; g0 = gm; }
    }
    // final linear interpolation across the tiny remaining interval
    return (g1 === g0) ? (x0 + x1) / 2 : x0 + (0 - g0) * (x1 - x0) / (g1 - g0);
  });

  roots.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  return Math.round(roots[0] * 100) / 100;
}

// Turn a CBOE delayed-quotes payload into contracts the engine can price.
// The apps already pulled strike and call/put out of the OCC symbol; what they
// never extracted was EXPIRY and IMPLIED VOL, which repricing needs.
//
// Two traps handled here:
//   - CBOE quotes iv sometimes as a percent (18.5) and sometimes as a decimal
//     (0.21). Treating 18.5 as 1850% vol silently flattens gamma to zero.
//   - A 0DTE contract has T = 0, which makes gamma undefined. It is floored at
//     one hour so today's expiry still contributes instead of vanishing.
const OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
const YEAR_MS = 365 * 24 * 3600 * 1000;

function parseChain(payload, now = new Date()) {
  const list = payload && payload.data && Array.isArray(payload.data.options)
    ? payload.data.options : [];
  const out = [];
  for (const o of list) {
    const m = OCC.exec(o && o.option ? String(o.option) : "");
    if (!m) continue;
    const oi = Number(o.open_interest) || 0;
    if (oi <= 0) continue;

    let iv = Number(o.iv);
    if (!(iv > 0)) continue;
    if (iv > 3) iv = iv / 100;

    const yy = 2000 + Number(m[2].slice(0, 2));
    const mm = Number(m[2].slice(2, 4));
    const dd = Number(m[2].slice(4, 6));
    const expMs = Date.UTC(yy, mm - 1, dd, 20, 0, 0); // 16:00 ET settlement
    const T = Math.max((expMs - now.getTime()) / YEAR_MS, 1 / (365 * 24));

    out.push({ K: Number(m[4]) / 1000, cp: m[3], T, iv, oi, exp: m[2] });
  }
  return out;
}

module.exports = { bsGamma, netGammaAt, zeroGamma, parseChain };
