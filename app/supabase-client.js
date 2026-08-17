// Shared Supabase client for the Kitscore app pages.
// Uses the same public anon key already exposed in index.html — this key is
// safe to ship client-side; access is enforced by the RLS policies on the
// database, not by hiding this value.
const SUPABASE_URL = 'https://tpcriphrfrrgywycviqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY3JpcGhyZnJyZ3l3eWN2aXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTI3OTcsImV4cCI6MjA5NzE4ODc5N30.pDACvVfUMi8McYJ0zxI1Qs5vG_JcQoG-FXGE8WQl5yY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Shared image-upload constants/helper -- used by avatar uploads (profile.html,
// dashboard.html hero) and by the Verified Media Kit gallery/collaboration-logo
// uploads (dashboard.html). Previously defined separately in profile.html only;
// moved here so dashboard.html doesn't need its own copy.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
function extFor(file) {
  return (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
}

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
  // Was: sb.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle()
  // profiles.email is no longer directly selectable by anon/authenticated
  // (see fix_profiles_email_public_leak migration) -- this RPC is scoped
  // server-side to the caller's own row via auth.uid(), so it's the one
  // legitimate path back to your own email.
  const { data, error } = await sb.rpc('fn_get_my_profile');
  if (error) { console.error('getCurrentProfile error:', error); return null; }
  return data;
}

// Creates the profile (and matching creators/sponsors row) for the given
// authenticated user from an explicit role + display name. Shared by
// ensureProfile() (metadata path) and the "finish setting up your
// account" fallback (manual path) below, so there's one place that
// actually writes the row.
async function createProfile(user, role, displayName) {
  const { data: profile, error: profileErr } = await sb.from('profiles')
    .insert({ auth_user_id: user.id, role, display_name: displayName, email: user.email })
    .select().single();
  if (profileErr) {
    console.error('createProfile: profile insert failed:', profileErr.message);
    await logProfileCreationFailure(user, profileErr.message);
    return null;
  }

  if (role === 'creator') {
    await sb.from('creators').insert({ id: profile.id });
  } else {
    await sb.from('sponsors').insert({ id: profile.id, company_name: displayName });
  }
  return profile;
}

// Best-effort visibility into ensureProfile() failures so these don't stay
// invisible the way the missing-metadata dead-end did. Never throws — a
// logging failure must not block or mask the original error.
async function logProfileCreationFailure(user, reason) {
  try {
    await sb.rpc('fn_log_client_failure', {
      p_kind: 'profile_creation',
      p_detail: reason,
      p_context: { auth_user_id: user?.id, email: user?.email }
    });
  } catch (e) { /* logging is best-effort; original error already surfaced above */ }
}

// Ensures a profile (and matching creators/sponsors row) exists for the given
// authenticated user, creating it from their signup metadata if missing.
// Safe to call on every login/session — no-ops if the profile already exists.
// This covers users who confirmed their email and are logging in for the
// first time, since the signup form itself only runs while an immediate
// session exists (i.e. when email confirmation is disabled).
//
// If the account has no role/display_name metadata (e.g. accept-invite.html's
// signUp() doesn't set any, or an account was created directly through
// Supabase rather than through our forms), this used to log a console error
// and return null, leaving the person stuck on "Signed in, but no profile
// found" with no way to recover. Now it returns a sentinel so the caller can
// show a small "finish setting up your account" form instead.
const PROFILE_INCOMPLETE = Symbol('profile_incomplete');

async function ensureProfile(user) {
  if (!user) return null;
  const existing = await getCurrentProfile();
  if (existing) return existing;

  const role = user.user_metadata?.role;
  const displayName = user.user_metadata?.display_name;
  if (!role || !displayName) return PROFILE_INCOMPLETE;

  return createProfile(user, role, displayName);
}

// Earliest connected_at among a creator's currently-connected OAuth-verified
// platforms -- "continuously verified since," not "first ever verified"
// (if a platform is disconnected and reconnected, this correctly moves
// forward). Mirrors fn_get_evekit_profile's verified_since exactly.
// Shared here (moved from evekit.html, which had its own copy) so
// profile.html and dashboard.html can both surface it in the hero
// without duplicating the calc. Expects rows shaped like
// fn_creator_platform_summary's output: { verification_method, connected_at }.
function computeVerifiedSince(platformConnections) {
  const oauthConnectedDates = (platformConnections || [])
    .filter(p => p.verification_method === 'oauth' && p.connected_at)
    .map(p => p.connected_at);
  return oauthConnectedDates.length ? oauthConnectedDates.sort()[0] : null;
}

function formatVerifiedSince(verifiedSince) {
  return verifiedSince ? new Date(verifiedSince).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : null;
}

// Redirects to auth.html if nobody is signed in, or to the wrong dashboard
// if the signed-in profile's role doesn't match what this page expects.
async function requireRole(expectedRole) {
  const profile = await getCurrentProfile();
  if (!profile) { window.location.href = 'auth.html'; return null; }
  if (profile.role !== expectedRole) {
    const home = profile.role === 'creator' ? 'dashboard.html' : profile.role === 'admin' ? 'admin-evidence.html' : profile.role === 'manager' ? 'agency.html' : 'directory.html';
    window.location.href = home;
    return null;
  }
  return profile;
}
