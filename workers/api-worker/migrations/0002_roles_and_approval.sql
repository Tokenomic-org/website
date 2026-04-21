-- Tokenomic D1 migration v2 — role progression + admin approval workflow
-- Apply with: wrangler d1 execute tokenomic-db --file=./migrations/0002_roles_and_approval.sql --remote
--
-- Compatibility notes:
--   * profiles.role (legacy single role) is kept for backward read paths;
--     new code MUST use profiles.roles (JSON array) which subsumes it.
--   * status enums on courses/communities/articles are documented here only;
--     SQLite has no CHECK enforcement after-the-fact and we want to avoid a
--     table-rebuild migration on D1.
--   * All ALTERs are wrapped in best-effort blocks via separate statements;
--     re-running this migration after partial application will surface
--     "duplicate column" errors which are safe to ignore.

-- ---------------------------------------------------------------------------
-- profiles: role progression fields
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN roles TEXT DEFAULT '["learner"]';
ALTER TABLE profiles ADD COLUMN streak_days INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN email TEXT;
ALTER TABLE profiles ADD COLUMN last_active_at TEXT;
ALTER TABLE profiles ADD COLUMN reputation_stake_usdc INTEGER DEFAULT 0;

-- Backfill: derive roles JSON from legacy single-role column for existing rows.
-- (NULL stays NULL; rows with role='student' become ["learner"], etc.)
UPDATE profiles
SET roles = CASE
  WHEN role = 'student'    THEN '["learner"]'
  WHEN role = 'learner'    THEN '["learner"]'
  WHEN role = 'educator'   THEN '["learner","educator"]'
  WHEN role = 'consultant' THEN '["learner","consultant"]'
  WHEN role = 'admin'      THEN '["learner","admin"]'
  ELSE '["learner"]'
END
WHERE roles IS NULL OR roles = '["learner"]';

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ---------------------------------------------------------------------------
-- approval workflow columns on user-generated content
--   status enum (documented): draft | pending_review | needs_changes
--                            | published | rejected | archived
-- ---------------------------------------------------------------------------
ALTER TABLE courses     ADD COLUMN admin_feedback TEXT;
ALTER TABLE courses     ADD COLUMN submitted_at   TEXT;
ALTER TABLE courses     ADD COLUMN reviewed_by    TEXT;
ALTER TABLE courses     ADD COLUMN reviewed_at    TEXT;

ALTER TABLE communities ADD COLUMN admin_feedback TEXT;
ALTER TABLE communities ADD COLUMN submitted_at   TEXT;
ALTER TABLE communities ADD COLUMN reviewed_by    TEXT;
ALTER TABLE communities ADD COLUMN reviewed_at    TEXT;

ALTER TABLE articles    ADD COLUMN admin_feedback TEXT;
ALTER TABLE articles    ADD COLUMN submitted_at   TEXT;
ALTER TABLE articles    ADD COLUMN reviewed_by    TEXT;
ALTER TABLE articles    ADD COLUMN reviewed_at    TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_pending     ON courses(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_communities_pending ON communities(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_articles_pending    ON articles(status, submitted_at);

-- ---------------------------------------------------------------------------
-- applications: educator / consultant role applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_wallet TEXT NOT NULL,
  role_requested   TEXT NOT NULL,            -- 'educator' | 'consultant'
  bio              TEXT NOT NULL,
  expertise        TEXT,                     -- JSON array of tags
  sample_url       TEXT,
  portfolio_url    TEXT,
  hourly_rate_usdc INTEGER,                  -- consultant only
  availability     TEXT,                     -- free-form text or JSON
  credentials      TEXT,                     -- declarative
  status           TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|needs_changes
  admin_feedback   TEXT,
  reviewer_wallet  TEXT,
  reviewed_at      TEXT,
  stake_tx_hash    TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_status   ON applications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_applications_wallet   ON applications(applicant_wallet, created_at);

-- ---------------------------------------------------------------------------
-- audit_log: every admin action (approve/reject/role change) leaves a trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_wallet  TEXT,
  action        TEXT NOT NULL,               -- e.g. 'application.approved'
  target_type   TEXT,                        -- 'application' | 'course' | ...
  target_id     TEXT,
  metadata      TEXT,                        -- JSON
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);
