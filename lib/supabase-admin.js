// Server-only helpers. Uses the Supabase SERVICE ROLE key, which bypasses RLS —
// this file must never be imported into anything that ships to the browser.
const { createClient } = require('@supabase/supabase-js');

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verifies the caller's Supabase session token (sent from the browser) and
// returns their profile row if it matches expectedRole, or null otherwise.
// This is what stops one user from spending another user's money or
// reading/unlocking someone else's data.
async function getAuthedProfile(req, expectedRole) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return null;

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('*')
    .eq('auth_user_id', user.id).eq('role', expectedRole).maybeSingle();
  return profile;
}

// Back-compat alias used by existing sponsor-only endpoints.
async function getAuthedSponsor(req) {
  return getAuthedProfile(req, 'sponsor');
}

async function getAuthedCreator(req) {
  const profile = await getAuthedProfile(req, 'creator');
  if (!profile) return null;
  const admin = adminClient();
  const { data: creator } = await admin.from('creators').select('*').eq('id', profile.id).maybeSingle();
  return creator ? { ...profile, ...creator, id: profile.id } : null;
}

module.exports = { adminClient, getAuthedSponsor, getAuthedCreator, getAuthedProfile };
