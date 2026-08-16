/*
 * Prior-day and overnight high/low for NQ, from free Yahoo bars.
 *
 * Sessions are resolved with a real IANA timezone, never a fixed UTC offset:
 * over a year a hardcoded -240 puts every winter session an hour out, which
 * silently folds the last hour of overnight into the RTH high and produces a
 * level that looks perfectly reasonable and is wrong.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

const _FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});

function nyParts(msEpoch) {
  const p = {};
  for (const { type, value } of _FMT.formatToParts(msEpoch)) p[type] = value;
  // Some ICU versions render midnight as hour "24" under hour12:false.
  const hour = Number(p.hour) % 24;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hour, minute: Number(p.minute),
  };
}

const _dayKey = (p) => p.y * 10000 + p.m * 100 + p.d;
const _mins = (p) => p.hour * 60 + p.minute;

const RTH_OPEN = 9 * 60 + 30;    // 09:30 New York
const RTH_CLOSE = 16 * 60;       // 16:00
const ON_OPEN = 18 * 60;         // 18:00 - the CME session opens the evening before
const SHIFT_SEC = 6 * 3600;

/*
 * Which overnight session a bar belongs to.
 *
 * An overnight straddles midnight, so its bars carry two different calendar
 * dates. Shifting six hours forward maps 18:00 to 00:00 of the NEXT day and
 * leaves 00:00-09:29 on its own day, so both halves land on one key - the
 * morning the session ends. That is the date a trader means by "last night".
 */
const _overnightKey = (tSec) => _dayKey(nyParts((tSec + SHIFT_SEC) * 1000));

/*
 * `nowSec` is passed in rather than read from the clock so behaviour is
 * testable, and so a run at 08:00 and a run at 08:40 describe the same day.
 */
function sessionLevels(bars, nowSec) {
  const now = nyParts(nowSec * 1000);
  const today = _dayKey(now);
  const nowMin = _mins(now);
  const currentOvernight = _overnightKey(nowSec);

  const hi = (rows) => (rows.length ? Math.max(...rows.map((r) => r.h)) : null);
  const lo = (rows) => (rows.length ? Math.min(...rows.map((r) => r.l)) : null);

  const tagged = (bars || []).map((b) => {
    const p = nyParts(b.t * 1000);
    return { h: b.h, l: b.l, day: _dayKey(p), min: _mins(p), on: _overnightKey(b.t) };
  });

  // --- prior day -----------------------------------------------------
  // The most recent regular session that has FINISHED. Today's own session
  // qualifies only once 16:00 has passed - before that it is still being made,
  // and calling a running session's extremes "prior day high" is simply wrong.
  const rth = tagged.filter((b) => b.min >= RTH_OPEN && b.min < RTH_CLOSE);
  const finished = rth.filter((b) => b.day < today || (b.day === today && nowMin >= RTH_CLOSE));
  const priorDay = finished.length ? Math.max(...finished.map((b) => b.day)) : null;
  const prior = finished.filter((b) => b.day === priorDay);

  // --- overnight -----------------------------------------------------
  // Yahoo returns five days, so several overnights are in the window. Only the
  // most recent one that has actually started is "last night".
  const onBars = tagged.filter((b) => (b.min >= ON_OPEN || b.min < RTH_OPEN)
                                      && b.on <= currentOvernight);
  const onKey = onBars.length ? Math.max(...onBars.map((b) => b.on)) : null;
  const overnight = onBars.filter((b) => b.on === onKey);

  return { pdh: hi(prior), pdl: lo(prior), onh: hi(overnight), onl: lo(overnight) };
}

async function fetchBars() {
  // 5m over 5 days: fine enough to place a session extreme, and well inside
  // Yahoo's 60-day cap for 5-minute data. includePrePost is deliberately NOT
  // set - on ETFs it returns odd-lot prints with wild highs and lows.
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/NQ=F?interval=5m&range=5d';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!r || !q || !Array.isArray(r.timestamp)) throw new Error('Unexpected Yahoo response shape');

  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const h = q.high[i], l = q.low[i], c = q.close[i];
    // Yahoo pads gaps with nulls. A null coerced to 0 becomes a session low of
    // zero, which would draw a line at the bottom of the chart.
    if (h == null || l == null || c == null) continue;
    out.push({ t: r.timestamp[i], h, l, c });
  }
  if (!out.length) throw new Error('Yahoo returned no usable bars');
  return out;
}

module.exports = { nyParts, sessionLevels, fetchBars };
