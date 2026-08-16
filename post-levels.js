/*
 * Announce the freshly built levels file in Discord, with the download link.
 *
 * Runs after build-levels.js in the morning job. A failure here must never fail
 * the build: the file is the product and it is already committed by the time
 * this runs - the post is a convenience.
 */
const fs = require('fs');
const path = require('path');

const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
// The repo's default branch is master, NOT main. A raw URL on main 404s.
const RAW = 'https://raw.githubusercontent.com/Zerdon23/gamma-discord/master/levels/NQ-latest.xml';
const APP = 'https://github.com/Zerdon23/gamma-discord/releases/latest';

(async () => {
  if (!WEBHOOK) { console.log('No webhook configured - not posting.'); return; }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, 'levels', 'latest.json'), 'utf8'));
  } catch (e) {
    console.error(`No levels to post: ${e.message}`);
    return;
  }

  const lines = (data.levels || []).map((l) => l.label).join('\n');
  const body = {
    username: 'DeepCharts Levels',
    embeds: [{
      title: `NQ levels — ${new Date().toISOString().slice(0, 10)}`,
      description:
        '```\n' + lines + '\n```\n' +
        `[Download the DeepCharts file](${RAW})  ·  [Get the app](${APP})`,
      color: data.regime === 'positive' ? 0x3ba776 : 0xe05a5a,
      footer: {
        text: 'CBOE delayed chain + Yahoo. Context and targets, not triggers.',
      },
    }],
  };

  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(res.ok ? 'Posted levels to Discord.' : `Discord post failed HTTP ${res.status}`);
  } catch (e) {
    console.error(`Discord post failed: ${e.message}`);
  }
})();
