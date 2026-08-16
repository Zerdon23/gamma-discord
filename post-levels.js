/*
 * Post the morning levels into Discord so nobody has to go looking for them.
 *
 * The levels FILE is attached, not linked. A raw.githubusercontent.com link
 * opens the JSON as text in a browser, and someone who is not technical has no
 * reason to know they should right-click and Save As - which is exactly the
 * person this is for. Attached, it is one click.
 *
 * The injector is LINKED, not attached, for three reasons: the zip is ~11MB and
 * a non-boosted server caps webhook uploads at 10MB; an attachment is frozen at
 * post time while a release link always serves the newest build; and re-posting
 * the same 11MB every weekday is noise when only the levels change daily.
 *
 * A failure here must never fail the build - the file is already committed by
 * the time this runs, so the post is a convenience, not the product.
 *
 *   node post-levels.js          post it
 *   node post-levels.js --dry    build the payload and print it, post nothing
 */
const fs = require('fs');
const path = require('path');

const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
// This repo's default branch is master, NOT main. A raw URL on main 404s.
const RELEASE = 'https://github.com/Zerdon23/gamma-discord/releases/latest';
const RAW = 'https://raw.githubusercontent.com/Zerdon23/gamma-discord/master/levels/NQ-latest.xml';

const DRY = process.argv.includes('--dry');
const LEVELS_DIR = path.join(__dirname, 'levels');

function build() {
  const meta = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, 'latest.json'), 'utf8'));
  const xml = fs.readFileSync(path.join(LEVELS_DIR, 'NQ-latest.xml'));
  const day = new Date().toISOString().slice(0, 10);

  const list = (meta.levels || []).map((l) => l.label).join('\n');
  const payload = {
    username: 'DeepCharts Levels',
    embeds: [{
      title: `NQ levels — ${day}`,
      description:
        '**The file is attached below — download it and import it into DeepCharts.**\n' +
        `First time? **[Download the injector app](${RELEASE})** — it fetches the levels ` +
        'and draws them for you.\n\n' +
        '```\n' + list + '\n```\n' +
        '**No app needed:** save the attached file, click your chart, press **Page Up**, ' +
        'choose it.',
      color: meta.regime === 'positive' ? 0x3ba776 : 0xe05a5a,
      fields: [
        { name: 'Gamma regime', value: meta.regime === 'positive' ? 'Positive' : 'Negative', inline: true },
        { name: 'NQ at build', value: String(Math.round(meta.nqSpot)), inline: true },
        { name: 'Levels', value: String((meta.levels || []).length), inline: true },
      ],
      footer: {
        text: 'CBOE delayed chain + Yahoo · rebuilt every weekday morning · '
              + 'context and targets, not triggers',
      },
    }],
  };
  return { payload, xml, filename: `NQ-Levels-${day}.xml` };
}

(async () => {
  let built;
  try {
    built = build();
  } catch (e) {
    console.error(`No levels to post: ${e.message}`);
    return;
  }

  if (DRY) {
    console.log(JSON.stringify(built.payload, null, 2));
    console.log(`\n(dry run - would attach ${built.filename}, ${built.xml.length} bytes)`);
    return;
  }
  if (!WEBHOOK) { console.log('No webhook configured - not posting.'); return; }

  try {
    // Multipart, matching the shape gamma-check.js already uses to attach its
    // TradingView file. Node 20+ has FormData/Blob globally.
    const form = new FormData();
    form.append('payload_json', JSON.stringify(built.payload));
    form.append('files[0]', new Blob([built.xml], { type: 'application/xml' }), built.filename);

    const res = await fetch(WEBHOOK, { method: 'POST', body: form });
    if (res.ok) {
      console.log(`Posted levels to Discord with ${built.filename} attached.`);
    } else {
      const body = await res.text().catch(() => '');
      console.error(`Discord post failed HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`Discord post failed: ${e.message}`);
  }
})();
