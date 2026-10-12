# NQ levels, built in the cloud

Runs on GitHub's free scheduler. No PC, no server, no API key, no npm
dependencies — Node built-ins only.

Every weekday morning it reads CBOE's free delayed `_NDX` option chain, works
out where the gamma sits, converts it onto NQ futures prices, and publishes
three things. Then, every 30 minutes while the session is open, it rebuilds and
speaks up **only if a level actually moved**.

## What it produces

| Output | For | Cadence |
|---|---|---|
| `levels/NQ-latest.xml` | DeepCharts — import it and the levels draw themselves | morning |
| `tradingview/AQQ-Gamma-NQ.txt` | TradingView — sent to the crew channel only, never committed | morning |
| A Discord post | reading on a phone | morning, plus on a real change |

The `.xml` extension on the DeepCharts file is the platform's choice, not a
mistake — it contains JSON, and renaming it breaks the import.

### The TradingView indicator

Two halves, built differently on purpose.

**AQQ Levels and AQQ SMT** are Brandon's own scripts, spliced in verbatim. Both work
everything out from the viewer's chart, so **they cannot go stale**. They are his
paid mentorship code, so they live in the PRIVATE repo `Zerdon23/aqq-friends-pine`
(refresh it with `node extract.js` there after editing the AQQ scripts). The
workflow checks it out into `aqq/` using the `AQQ_REPO_TOKEN` secret, and the
finished script is gitignored here because this repo is public. (The Goldbach
grid this used to carry was removed 2026-10-12.)

The **gamma levels** are this morning's numbers written into the file, because
Pine cannot fetch anything. They come from open interest, which rebuilds
overnight, so they are right for one session. The script prints its build date
on the chart, and hides the gamma half entirely on any symbol that is not NQ —
those prices are NQ prices and would be meaningless elsewhere.

## Where it posts

- **Public channel** — a webhook, stored as the repo secret `DISCORD_WEBHOOK`.
- **Private crew channel** — a real Discord bot, so it can be a member of
  someone else's server. Needs `FRIENDS_BOT_TOKEN` and `FRIENDS_CHANNEL_ID`.

### The crew bot is not switched on

**Neither of those two secrets is set.** Until they are, `friends-update.js`
returns `not configured` on every run and sends nothing — and the workflow still
goes green, so nothing about a successful run tells you this.

To switch it on, run **`Connect Friends Bot.bat`** once. It asks for the bot
token, checks it, prints the invite link for the server owner, lets you pick the
server and channel, stores both as encrypted Actions secrets, and sends a test
message. The token is read from the keyboard and piped straight into
`gh secret set` — never printed, never written to a file, never passed as a
command-line argument.

## Running it by hand

GitHub → **Actions** → **DeepCharts Levels** → **Run workflow**. Tick the
morning box to post the full set even if nothing has moved.

Locally:

```
node --test                  # the offline suite, ~150 checks
node build-levels.js         # fetch and build levels/
node build-pine.js           # write the TradingView indicator
node friends-update.js --dry # decide out loud, send nothing
```

`node build-pine.js` refuses to write anything if `levels/latest.json` predates
the stale-basis fix, because a wrong wall looks exactly as authoritative as a
right one.

## What these levels are worth

Context and targets, not triggers.

Measured over three years of NQ: **no level family — gamma walls, prior day,
overnight, session highs and lows, round numbers — holds better than a randomly
chosen price.** Random holds about 62%, and that is the bar any claim about a
level has to clear. Use them to know where you are and where you might be
going, not as a reason to enter.
