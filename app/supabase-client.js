// Shared Supabase client for the Kitscore app pages.
// Uses the same public anon key already exposed in index.html — this key is
// safe to ship client-side; access is enforced by the RLS policies on the
// database, not by hiding this value.
const SUPABASE_URL = 'https://tpcriphrfrrgywycviqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY3JpcGhyZnJyZ3l3eWN2aXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTI3OTcsImV4cCI6MjA5NzE4ODc5N30.pDACvVfUMi8McYJ0zxI1Qs5vG_JcQoG-FXGE8WQl5yY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Returns the signed-in user's profile row (or null), creating nothing.
async function getCurrentProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle();
  if (error) { console.error('getCurrentProfile error:', error); return null; }
  return data;
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
