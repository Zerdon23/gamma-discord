/*
 * One-time setup for the crew levels bot.
 *
 * Ask for the bot token, check it, print the invite link, let you pick the
 * server and channel, store both as encrypted GitHub Actions secrets, and
 * send a test message.
 *
 * The token is read from the keyboard and piped straight into `gh secret set`
 * over stdin. It is never printed, never written to a file, never passed as a
 * command-line argument (argv is readable by any other process on the machine)
 * and never typed into a chat window.
 *
 *   node setup-friends-bot.js
 */
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const API = 'https://discord.com/api/v10';
const REPO = 'Zerdon23/gamma-discord';

// Exactly what the bot needs and nothing more, so the authorize screen your
// friend sees is short and boring:
//   View Channel 1024 + Send Messages 2048 + Embed Links 16384 + Attach Files 32768
const PERMISSIONS = 1024 + 2048 + 16384 + 32768; // 52224

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

/** Ask without echoing to the screen - someone may be looking over a shoulder. */
function askSecret(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const onData = (char) => {
      // Redraw the prompt with nothing after it as each character arrives.
      if (!['\n', '\r', ''].includes(String(char))) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(q);
      }
    };
    process.stdin.on('data', onData);
    rl.question('', (value) => {
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(value.trim());
    });
  });
}

async function discord(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`Discord said ${res.status} for ${path}`);
  return res.json();
}

/** Store a secret without it ever touching argv or the disk. */
function setSecret(name, value) {
  return new Promise((resolve, reject) => {
    const gh = spawn('gh', ['secret', 'set', name, '--repo', REPO], {
      stdio: ['pipe', 'inherit', 'inherit'], shell: true,
    });
    gh.on('error', reject);
    gh.on('close', (code) => (code === 0
      ? resolve()
      : reject(new Error(`gh secret set ${name} exited ${code}`))));
    gh.stdin.end(value);
  });
}

(async () => {
  console.log('\n  CREW LEVELS BOT - SETUP');
  console.log('  ───────────────────────\n');
  console.log('  Make the bot first, if you have not already:');
  console.log('    1. discord.com/developers/applications  ->  New Application');
  console.log('    2. Bot (left menu)  ->  Reset Token  ->  Copy\n');

  const token = await askSecret('  Paste the bot token (it will not show): ');
  if (!token) { console.log('\n  Nothing pasted. Run it again when you have the token.\n'); rl.close(); return; }

  let me;
  try {
    me = await discord(token, '/users/@me');
  } catch (e) {
    console.log(`\n  That token did not work (${e.message}).`);
    console.log('  Reset the token in the Bot tab and copy the new one.\n');
    rl.close(); return;
  }
  console.log(`\n  Connected as: ${me.username}`);

  // For a bot, the user id IS the application id, so the invite link needs
  // nothing the token has not already given us.
  const invite = `https://discord.com/oauth2/authorize`
    + `?client_id=${me.id}&scope=bot&permissions=${PERMISSIONS}`;

  let guilds = await discord(token, '/users/@me/guilds');
  if (!guilds.length) {
    console.log('\n  The bot is not in any server yet. Open this link and pick');
    console.log('  your friend\'s server (or send the link to whoever runs it):\n');
    console.log(`  ${invite}\n`);
    await ask('  Press Enter once it has been added... ');
    guilds = await discord(token, '/users/@me/guilds');
    if (!guilds.length) {
      console.log('\n  Still not in a server. Add it with that link, then run this again.\n');
      rl.close(); return;
    }
  }

  let guild = guilds[0];
  if (guilds.length > 1) {
    console.log('\n  Which server?\n');
    guilds.forEach((g, i) => console.log(`    ${i + 1}. ${g.name}`));
    const pick = Number(await ask('\n  Number: '));
    guild = guilds[pick - 1] || guilds[0];
  }
  console.log(`\n  Server: ${guild.name}`);

  // type 0 is a normal text channel. Voice, categories and forums cannot take
  // a message and would fail at post time rather than here.
  const channels = (await discord(token, `/guilds/${guild.id}/channels`))
    .filter((c) => c.type === 0);
  if (!channels.length) {
    console.log('\n  The bot cannot see any text channel in that server.');
    console.log('  Give it access to the private channel, then run this again.\n');
    rl.close(); return;
  }

  console.log('\n  Which channel should the levels go in?\n');
  channels.forEach((c, i) => console.log(`    ${i + 1}. #${c.name}`));
  const pick = Number(await ask('\n  Number: '));
  const channel = channels[pick - 1] || channels[0];

  console.log(`\n  Saving to GitHub so the cloud job can use it...`);
  await setSecret('FRIENDS_BOT_TOKEN', token);
  await setSecret('FRIENDS_CHANNEL_ID', channel.id);

  const test = await fetch(`${API}/channels/${channel.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      content: 'Levels bot connected. The morning set lands here on weekdays, '
        + 'plus an update whenever a level actually moves.',
    }),
  });

  console.log(test.ok
    ? `\n  Done. Test message sent to #${channel.name} in ${guild.name}.\n`
    : `\n  Saved, but the test message failed (HTTP ${test.status}).`
      + `\n  The bot probably cannot post in #${channel.name} - check its`
      + '\n  channel permissions include Send Messages and Attach Files.\n');
  rl.close();
})().catch((e) => { console.error(`\n  Setup failed: ${e.message}\n`); rl.close(); });
