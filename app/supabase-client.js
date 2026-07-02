// Shared Supabase client for the Kitscore app pages.
// Uses the same public anon key already exposed in index.html — this key is
// safe to ship client-side; access is enforced by the RLS policies on the
// database, not by hiding this value.
const SUPABASE_URL = 'https://tpcriphrfrrgywycviqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY3JpcGhyZnJyZ3l3eWN2aXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTI3OTcsImV4cCI6MjA5NzE4ODc5N30.pDACvVfUMi8McYJ0zxI1Qs5vG_JcQoG-FXGE8WQl5yY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Escapes user-controlled text before it's interpolated into an innerHTML
// template literal (display names, campaign names, filenames, etc. all
// come from creator/sponsor input and are not safe to inject raw).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Returns the signed-in user's profile row (or null), creating nothing.
async function getCurrentProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle();
  if (error) { console.error('getCurrentProfile error:', error); return null; }
  return data;
}

// Ensures a profile (and matching creators/sponsors row) exists for the given
// authenticated user, creating it from their signup metadata if missing.
// Safe to call on every login/session — no-ops if the profile already exists.
// This covers users who confirmed their email and are logging in for the
// first time, since the signup form itself only runs while an immediate
// session exists (i.e. when email confirmation is disabled).
async function ensureProfile(user) {
  if (!user) return null;
  const existing = await getCurrentProfile();
  if (existing) return existing;

  const role = user.user_metadata?.role;
  const displayName = user.user_metadata?.display_name;
  if (!role || !displayName) {
    console.error('ensureProfile: missing role/display_name metadata for user', user.id);
    return null;
  }

  const { data: profile, error: profileErr } = await sb.from('profiles')
    .insert({ auth_user_id: user.id, role, display_name: displayName, email: user.email })
    .select().single();
  if (profileErr) { console.error('ensureProfile: profile insert failed:', profileErr.message); return null; }

  if (role === 'creator') {
    await sb.from('creators').insert({ id: profile.id });
  } else {
    await sb.from('sponsors').insert({ id: profile.id, company_name: displayName });
  }
  return profile;
}

// Redirects to auth.html if nobody is signed in, or to the wrong dashboard
// if the signed-in profile's role doesn't match what this page expects.
async function requireRole(expectedRole) {
  const profile = await getCurrentProfile();
  if (!profile) { window.location.href = 'auth.html'; return null; }
  if (profile.role !== expectedRole) {
    window.location.href = profile.role === 'creator' ? 'dashboard.html' : 'directory.html';
    return null;
  }
  return profile;
}
