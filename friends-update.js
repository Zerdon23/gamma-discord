/*
 * The private crew channel: post the levels when they need re-drawing.
 *
 *   node friends-update.js --morning   the daily set, always posts
 *   node friends-update.js             an intraday check, posts only on a change
 *   node friends-update.js --dry       decide out loud, send nothing
 *
 * Reads a build that build-levels.js has already written. Decides with
 * notify.js. Sends with post-bot.js. Remembers in state/friends.json.
 *
 * THE ONE RULE THAT MATTERS HERE: the state is written only after Discord has
 * accepted the message. Recording a change we failed to send would make every
 * later check read "nothing moved", and the update would be lost silently for
 * the rest of the day.
 *
 * The state lives in state/, deliberately NOT in levels/. The morning workflow
 * does `git add levels/`, and a state file in there would ride along into the
 * public levels commit on a run that never meant to touch it.
 */
const fs = require('node:fs');
const path = require('node:path');
const N = require('./notify.js');
const P = require('./post-bot.js');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function run({
  root = __dirname,
  token = process.env.FRIENDS_BOT_TOKEN || '',
  channelId = process.env.FRIENDS_CHANNEL_ID || '',
  baseUrl,
  now = new Date(),
  morning = false,
  dry = false,
} = {}) {
  const statePath = path.join(root, 'state', 'friends.json');
  const meta = readJson(path.join(root, 'levels', 'latest.json'));
  let xml = null;
  try { xml = fs.readFileSync(path.join(root, 'levels', 'NQ-latest.xml')); } catch { /* below */ }

  if (!meta || !xml) {
    return { posted: false, reason: 'no levels build to read - nothing to post' };
  }
  if (!token || !channelId) {
    return { posted: false, reason: 'not configured - no bot token or channel id yet' };
  }

  // A corrupt or absent state file reads as no history, which posts. Being
  // told twice is a nuisance; going quiet because a file got mangled is a bug.
  const decision = N.decide({
    levels: meta.levels, state: readJson(statePath), now, morning,
  });

  if (!decision.post) return { posted: false, reason: decision.reason };
  if (dry) return { posted: false, reason: `would post - ${decision.reason}` };

  const res = await P.post({
    token, channelId, baseUrl, meta, xml, now,
    morning, changed: decision.changed,
  });

  if (!res.ok) return { posted: false, reason: `post failed - ${res.error}` };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(decision.nextState, null, 2)}\n`);
  return { posted: true, reason: decision.reason, changed: decision.changed };
}

module.exports = { run };

if (require.main === module) {
  run({
    morning: process.argv.includes('--morning'),
    dry: process.argv.includes('--dry'),
  }).then((r) => {
    console.log(`${r.posted ? 'Posted' : 'Did not post'}: ${r.reason}`);
  }).catch((e) => {
    // Never fail the workflow over a Discord post.
    console.error(`friends-update crashed: ${e.message}`);
  });
}
