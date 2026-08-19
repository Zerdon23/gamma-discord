# Goldbach + Gamma — a TradingView indicator posted daily by a Discord bot

**Date:** 2026-08-19
**Repo:** `Zerdon23/gamma-discord` (public)
**Asked for:** "help me make a goldbach gamma indicator for my friends server"

## What this is

One TradingView Pine v6 script, rebuilt every weekday morning with that day's
gamma numbers written into it, delivered to a friends' Discord server by a bot.
A friend pastes it into TradingView's Pine Editor and has both halves of
Brandon's chart: the Goldbach dealing-range grid and today's dealer-gamma levels.

## Decisions taken (his, in order)

1. **TradingView**, over Quantower / DeepCharts / a plain Discord message.
   Free, nothing to install, works on a phone, one paste.
2. **Numbers baked into a fresh file daily** ("A"), over editable inputs that
   arrive pre-filled ("C"). The trade-off was stated: a friend who does not
   re-paste is looking at stale walls with nothing to tell them. He accepted it.
   *Mitigation inside his choice:* the script prints its build date on the chart.
3. **A real Discord bot** for delivery, over a webhook or a bare public link.

## The two halves, and why they are built differently

**Goldbach is computed live in Pine.** The dealing range is
`floor(price / PO3) * PO3`, so the grid re-derives itself as price moves into a
new block. Nothing about it can go stale — an old file still draws a correct
grid. It needs no data, no key, no network, which is exactly why it can live
inside a text file someone pastes.

**Gamma is written in as constants.** Pine cannot fetch external data, full
stop. The walls come from CBOE's free delayed chain via the pipeline already
running in this repo. They are open-interest based and rebuild overnight, so a
number written at 08:30 ET is still correct at the close — that is what makes a
once-a-morning file viable at all, and also what makes a three-day-old file wrong.

## Level table (ported verbatim from `amd-goldbach-quantower/AmdGoldbach.cs`)

| frac | code | name | colour (r,g,b) |
|---|---|---|---|
| -0.111 | Ext | Extension (low) | 90,150,255 |
| 0.00 | Low | Range Low | 224,90,90 |
| 0.03 | RB | Rejection Block | 224,110,110 |
| 0.11 | OB | Order Block | 74,158,255 |
| 0.17 | FVG | Fair Value Gap | 90,200,215 |
| 0.29 | LV | Liquidity Void | 180,140,255 |
| 0.41 | BR | Breaker | 232,176,72 |
| 0.47 | MB | Mitigation Block | 200,150,110 |
| 0.50 | EQ | Equilibrium | 240,200,90 |
| 0.53 | MB | Mitigation Block | 200,150,110 |
| 0.59 | BR | Breaker | 232,176,72 |
| 0.71 | LV | Liquidity Void | 180,140,255 |
| 0.83 | FVG | Fair Value Gap | 90,200,215 |
| 0.89 | OB | Order Block | 74,158,255 |
| 0.97 | RB | Rejection Block | 224,110,110 |
| 1.00 | High | Range High | 224,90,90 |
| 1.111 | Ext | Extension (high) | 90,150,255 |

Extremes and EQ draw solid and wider; interior arrays draw dashed. CE
(consequent encroachment) midpoints sit between consecutive DRAWN levels — so
toggling the extensions changes the CE set, and computing CE from a fixed list
would silently disagree with the Quantower indicator.

Label format matches the C# `"0.###"`: `0.5  EQ  29,524.50`, never `0.500`.

## Components

| File | Status | Job |
|---|---|---|
| `goldbach.js` | new | Pure arithmetic. `range(price, po3, shift)`, the table above, CE midpoints, `at(price)`. No I/O. |
| `pine.js` | new | Reads `levels/latest.json`, emits the finished Pine text. |
| `friends-update.js` | edit | Attach the generated `.txt` to the crew post. |
| `.github/workflows/gamma.yml` | edit | Write + commit the file on the morning run only. |
| `build-levels.js`, `cboe.js`, `basis.js` | **untouched** | The data path works. Nothing here reads the chain directly. |

Data in: `levels/latest.json`, which already carries `levels[]` in **NQ prices**
(the NDX to NQ offset is applied upstream and the build refuses to publish on a
stale offset), plus `builtAt`, `symbol`, `basis`, `regime`, `nqSpot`.

Data out: `tradingview/Goldbach-Gamma-NQ.txt` (stable name, overwritten) and a
dated archive alongside it.

## Behaviour of the generated script

- **Symbol guard.** The gamma prices are NQ prices. If the chart is not NQ the
  gamma half is hidden and a plain-language note says why. Goldbach keeps drawing.
- **PO3 auto-select.** Default 729 (right for NQ around 29,000). On another
  symbol, pick the PO3 whose block is roughly 2-4% of price, so the grid is
  usable on ES or SPY without the friend knowing what a PO3 is. Overridable.
- **Build-date stamp** in the corner, always on. The mitigation for decision 2.
- **`at(price)` reports out-of-range honestly** — when price sits outside the
  drawn range it says so rather than naming the nearest edge. (This exact bug
  was found and fixed in the desktop app; do not reintroduce it.)
- Toggles: extensions, CE lines, premium/discount shading, labels, gamma half.

## Pine constraints (each one has cost a failure before)

- Pine **v6**; ASCII only; no user-defined drawing function (they error when
  called conditionally); explicit `max_lines_count` / `max_labels_count`.
- Levels are redrawn on `barstate.islast` from persistent `var line[]` / `var
  label[]` arrays — delete then redraw, never accumulate per tick.
- Roughly 34 lines + 34 labels worst case (17 levels + up to 16 CE + gamma).
  Well inside the caps, but they are declared rather than assumed.
- **No price offset is applied.** `latest.json` is already NQ scale. Adding the
  basis again would move every wall by hundreds of points.

## Delivery

`friends-update.js` and `post-bot.js` already speak the Discord bot API and post
to a private crew channel. **They have never run:** the repo has only
`DISCORD_WEBHOOK` set — `FRIENDS_BOT_TOKEN` and `FRIENDS_CHANNEL_ID` were never
added, so every run so far returned "not configured" and sent nothing.

Switching it on is a one-time job only Brandon can do: `Connect Friends Bot.bat`
runs `setup-friends-bot.js`, which takes the bot token over stdin (never argv,
never a file, never chat), prints the invite link, lets him pick the server and
channel, and stores both as encrypted Actions secrets.

Until that runs, the file is still committed publicly each morning and the link
can be posted by hand. The indicator does not depend on the bot.

## Testing

Offline, zero-dependency, `node --test`:

- `goldbach.js` against values taken from the live Quantower indicator —
  `floor(30100/729)*729 = 29889`, `+729 = 30618`, EQ 30253.5 — plus the 243 and
  81 rows, which were verified against dmn's own stats box.
- Interior arrays mirror about equilibrium; the two extremes do **not** (they
  are named Low/High for their side). A mirror test that asserts otherwise is
  wrong — this was got backwards once already.
- `pine.js` output: contains every level, ASCII-only, caps declared, version
  line present, the day's walls present, and the build date present.
- Mutation-test the symbol guard and the no-offset rule: break each, confirm a
  test fails, restore.

**Not testable here:** Pine does not compile on this machine. Brandon pastes it
and reports red errors — the standing workflow for every Pine script in this stack.

## Explicitly out of scope

- The AMD session bands from the Quantower version. Offered, not asked for.
- Any change to how gamma is fetched or how the basis is measured.
- Any claim that these levels predict reactions. Three years of measurement say
  no level family holds better than a randomly chosen price. The script's own
  header says context and targets, not triggers.
