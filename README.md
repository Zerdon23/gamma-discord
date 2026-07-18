# Gamma Levels → Discord (cloud)

Runs on GitHub's free scheduler — no PC required. Every hour it reads CBOE's free
delayed option chain, computes the Call Wall / Put Wall / Gamma Flip for `_NDX`
(Nasdaq), and posts to a Discord channel **only when the levels change** (which is
about once a day, since the walls are open-interest based and update overnight).

- **No cost, no server, no API key.** Zero npm dependencies.
- The Discord webhook link is stored as the encrypted repo secret `DISCORD_WEBHOOK`
  (never in the code).
- `state.json` holds the last-posted levels and is committed back after each change,
  so a change is only announced once.

**Change the symbol:** edit `SYMBOL` in `.github/workflows/gamma.yml` (e.g. `_SPX`, `QQQ`, `SPY`).

**Run it by hand:** GitHub → Actions tab → "Gamma Levels to Discord" → Run workflow.

Companion to the PC version in `../gamma-discord` (that one only runs while the PC is on).
