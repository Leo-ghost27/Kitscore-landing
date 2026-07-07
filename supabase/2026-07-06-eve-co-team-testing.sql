-- Test-only: put Eve Co on Team plan and seat them as their own team's owner,
-- so the real Team UI (not the marketing/upsell page) actually renders.
-- Safe to re-run — skips team creation if Eve Co is already on a team.

DO $$
DECLARE
  v_profile_id uuid;
  v_team_id uuid;
BEGIN
  SELECT id INTO v_profile_id FROM sponsors WHERE company_name = 'Eve Co' LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No sponsor found with company_name = ''Eve Co''';
  END IF;

  UPDATE sponsors SET plan = 'team'::plan_tier WHERE id = v_profile_id;

  IF NOT EXISTS (SELECT 1 FROM team_members WHERE sponsor_id = v_profile_id) THEN
    INSERT INTO teams (name, owner_id) VALUES ('Eve Co', v_profile_id) RETURNING id INTO v_team_id;
    INSERT INTO team_members (team_id, sponsor_id, role) VALUES (v_team_id, v_profile_id, 'owner');
  END IF;
END $$;
