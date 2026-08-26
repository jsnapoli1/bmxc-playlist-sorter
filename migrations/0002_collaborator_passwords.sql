-- Collaborators pick a name and a password when they first use an invite
-- link, and sign back in with the same pair afterwards.
--
-- Before this, identity was only a session cookie. Losing the cookie —
-- clearing data, a private window, a new phone, iOS evicting storage —
-- meant re-clicking the invite and typing a name again, which inserted a
-- *new* collaborator row every time. The result was a participant list full
-- of duplicates ("Jack" twice, "Patrick McGoldrick" twice) and no way for
-- someone to get back to being themselves.
--
-- Nullable because existing collaborators have no password yet: they keep
-- working on their current session and set one the next time they sign in.

ALTER TABLE collaborators ADD COLUMN password_hash TEXT;
ALTER TABLE collaborators ADD COLUMN password_salt TEXT;

-- One person per name per plan, which is what makes "sign back in" resolve
-- to a single row. Partial so the pre-existing duplicates above do not break
-- the migration; they are cleaned up separately.
CREATE UNIQUE INDEX IF NOT EXISTS collaborators_plan_name
  ON collaborators(plan_id, display_name)
  WHERE password_hash IS NOT NULL;
