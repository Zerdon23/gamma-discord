/*
 * Post the levels into a private channel as a real bot user.
 *
 * The sibling post-levels.js posts to the public gamma channel through a
 * webhook. This one exists because a webhook cannot be a member of a server -
 * a bot can, which is what "a bot in our server" actually means, and it lets
 * the friend group see on the authorize screen exactly what it may do:
 * read the channel, send messages, attach files. Nothing else.
 *
 * Two differences from the webhook path that are easy to get wrong:
 *
 *   - the header is `Authorization: Bot <token>`. Not Bearer, not bare. Both
 *     of those 401, and a 401 looks identical to a bad token.
 *   - `username` and `avatar_url` are webhook-only. A bot silently ignores
 *     them, so sending one promises a display name that never appears.
 *
 * A failure here is reported, never thrown. The levels file is committed
 * before this runs, so the post is a convenience and must not fail the build.
 */

const API = 'https://discord.com/api/v10';

// Discord rejects the whole message if a description exceeds this.
const MAX_DESCRIPTION = 4096;

// Field names are for files. These are for people reading on a phone.
const PLAIN = {
  CALL_WALL: 'call wall',
  PUT_WALL: 'put wall',
  FLIP: 'gamma flip',
  GAMMA_POS: 'positive gamma shelf',
  GAMMA_NEG: 'negative gamma shelf',
  PDH: 'prior day high',
  PDL: 'prior day low',
  ONH: 'overnight high',
  ONL: 'overnight low',
  ASIA_H: 'Asia high',
  ASIA_L: 'Asia low',
  LONDON_H: 'London high',
  LONDON_L: 'London low',
  NY_H: 'New York high',
  NY_L: 'New York low',
};

/** A type we have no wording for still has to read as English, never "undefined". */
function plain(type) {
  return PLAIN[type] || String(type).toLowerCase().replace(/_/g, ' ');
}

function joinWords(list) {
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The list of levels, trimmed so it can never overflow the embed. */
function levelBlock(levels) {
  const lines = (levels || []).map((l) => l.label);
  const fence = (body) => '```\n' + body + '\n```';
  let out = fence(lines.join('\n'));
  let shown = lines.length;
  while (out.length > MAX_DESCRIPTION - 600 && shown > 1) {
    shown = Math.floor(shown * 0.8);
    out = fence(lines.slice(0, shown).join('\n')
      + `\n... and ${lines.length - shown} more in the file`);
  }
  return out;
}

/** The message body. Pure - no clock, no network - so it is testable. */
function message({ meta, morning, changed }) {
  const day = String(meta.builtAt || '').slice(0, 10);
  const words = (changed || []).map(plain);

  const headline = morning
    ? `NQ levels — ${day}`
    : `NQ levels moved — ${joinWords(words)}`;

  const lead = morning
    ? '**Today’s set.** Download the file below and import it into DeepCharts.'
    : `**${joinWords(words)} moved** since the morning post. `
      + 'Re-import the file below to redraw.';

  return {
    embeds: [{
      title: headline,
      description: `${lead}\n\n${levelBlock(meta.levels)}\n`
        + 'Save the file, click your chart, press **Page Up**, choose it.',
      color: meta.regime === 'positive' ? 0x3ba776 : 0xe05a5a,
      fields: [
        {
          name: 'Gamma regime',
          value: meta.regime === 'positive' ? 'Positive' : 'Negative',
          inline: true,
        },
        { name: 'NQ at build', value: String(Math.round(meta.nqSpot || 0)), inline: true },
        { name: 'Levels', value: String((meta.levels || []).length), inline: true },
      ],
      footer: {
        text: 'CBOE delayed chain + Yahoo · context and targets, not triggers — '
              + 'these levels do not hold better than a random price',
      },
    }],
  };
}

/** Send it. Returns {ok} or {ok:false, error}; never throws. */
async function post({ token, channelId, meta, xml, morning, changed,
                      baseUrl = API, now = new Date() }) {
  if (!token || !channelId) {
    return { ok: false, error: 'not configured - no bot token or channel id' };
  }

  const day = now.toISOString().slice(0, 10);
  const form = new FormData();
  form.append('payload_json', JSON.stringify(message({ meta, morning, changed })));
  form.append('files[0]',
    new Blob([xml], { type: 'application/xml' }), `NQ-Levels-${day}.xml`);

  try {
    const res = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
      body: form,
    });
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { post, message, plain, PLAIN };
