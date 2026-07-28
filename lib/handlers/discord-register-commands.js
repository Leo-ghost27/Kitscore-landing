// Handler for GET /api/discord-oauth?action=register-commands
// (rewritten from the friendlier /api/discord-register-commands, same
// pattern as the other provider rewrites in vercel.json)
//
// One-time setup, NOT part of the creator-facing OAuth flow in
// discord-oauth-start.js / discord-oauth-callback.js. Visiting this URL
// registers a single guild-scoped slash command against the KitScore
// Discord application, which is what the Developer Portal's App
// Discovery checklist needs to see before Discovery can be enabled.
//
// Gated by a shared-secret query param (DISCORD_SETUP_SECRET) rather
// than creator auth, since this configures the Discord *application*
// itself, not anything scoped to a signed-in creator. Safe to visit
// more than once -- registerGuildSlashCommands does a bulk overwrite
// (PUT), so re-running it just re-registers the same command rather
// than creating duplicates.
const { registerGuildSlashCommands } = require('../discord');

const COMMANDS = [
  {
    name: 'kitscore',
    description: 'Look up the current KitScore for this server',
    type: 1, // CHAT_INPUT
  },
];

function page(title, message, ok) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1a1a1a}
.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:16px}
.ok{background:#dcfce7;color:#166534}.err{background:#fee2e2;color:#991b1b}
pre{background:#f4f4f5;padding:12px;border-radius:8px;overflow:auto;font-size:13px}</style>
</head><body>
<span class="badge ${ok ? 'ok' : 'err'}">${ok ? 'Success' : 'Error'}</span>
<h1>${title}</h1>
<p>${message}</p>
</body></html>`;
}

module.exports = async function handleDiscordRegisterCommands(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const setupSecret = process.env.DISCORD_SETUP_SECRET;
  if (setupSecret) {
    const provided = req.query?.secret;
    if (provided !== setupSecret) {
      res.setHeader('Content-Type', 'text/html');
      return res
        .status(401)
        .send(page('Not authorized', 'Missing or incorrect setup secret.', false));
    }
  }

  try {
    const applicationId = process.env.DISCORD_APPLICATION_ID;
    const guildId = process.env.DISCORD_GUILD_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    const registered = await registerGuildSlashCommands({
      applicationId,
      guildId,
      botToken,
      commands: COMMANDS,
    });

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(
      page(
        'Slash commands registered',
        `Registered ${registered.length} command(s) on guild ${guildId}: ` +
          `${registered.map((c) => '/' + c.name).join(', ')}. ` +
          'Refresh the Developer Portal\u2019s App Discovery Status page \u2014 the slash command item should now be green.',
        true
      )
    );
  } catch (err) {
    res.setHeader('Content-Type', 'text/html');
    return res
      .status(500)
      .send(page('Registration failed', `<pre>${(err.message || 'Unknown error').replace(/</g, '&lt;')}</pre>`, false));
  }
};
