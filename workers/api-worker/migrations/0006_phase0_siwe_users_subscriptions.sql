-- 0006_phase0_siwe_users_subscriptions.sql
--
-- Schema contract: the canonical "users" table is `profiles`, created in an
-- earlier migration and keyed by `wallet_address` (lowercased EIP-55 hex).
-- We deliberately do NOT add a separate `users` table because every Phase 0+
-- relation already foreign-keys to `profiles.wallet_address`. SIWE sessions,
-- subscriptions, referrals, expert_profiles, lessons, community_members,
-- bookings and availability_providers all reference profiles directly.
-- If a future phase needs a richer auth/user model, the migration should
-- rename or extend `profiles` rather than introduce a parallel table.
--
--
-- Phase 0 D1 bootstrap: tables required by the rest of the Tokenomic build
-- plan (subscriptions, referrals, calendar bookings, expert profiles, …).
-- Existing tables intentionally kept untouched:
--   profiles      acts as the canonical `users` table (wallet PK + roles)
--   modules       lesson-equivalent for the current course player
--   articles, courses, communities, enrollments, bookings, audit_log
--
-- Apply with:
--   wrangler d1 execute tokenomic-db --file=./migrations/0006_phase0_siwe_users_subscriptions.sql --remote

-- -------------------------------------------------------------------------
-- expert_profiles : role-specific overlay for educators / consultants.
--   - one row per wallet that has elected to expose a public expert page.
--   - 1-1 with profiles.wallet_address (no FK because SQLite/D1 does not
--     enforce FKs by default; the column is the join key).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expert_profiles (
  wallet_address     TEXT PRIMARY KEY,            -- = profiles.wallet_address
  slug               TEXT UNIQUE,                  -- public URL slug
  headline           TEXT,                         -- short tagline
  long_bio_md        TEXT,                         -- full markdown bio
  expertise_tags     TEXT,                         -- JSON array of tags
  languages          TEXT,                         -- JSON array of ISO codes
  hourly_rate_usdc   INTEGER,                      -- consultancy floor
  session_30_usdc    INTEGER,                      -- 30-min slot price
  session_60_usdc    INTEGER,                      -- 60-min slot price
  cover_url          TEXT,
  links              TEXT,                         -- JSON {twitter,linkedin,…}
  visible            INTEGER NOT NULL DEFAULT 1,   -- 0 = hidden from list
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_visible ON expert_profiles(visible);

-- -------------------------------------------------------------------------
-- lessons : finer-grained alternative to `modules`. Phase 2 introduces a
-- richer player; until then both tables coexist (modules holds the legacy
-- markdown-per-module shape, lessons holds the future video-first shape).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id        INTEGER NOT NULL,
  module_id        INTEGER,                        -- optional grouping
  position         INTEGER NOT NULL DEFAULT 0,
  title            TEXT NOT NULL,
  summary          TEXT,
  body_md          TEXT,
  stream_video_uid TEXT,                           -- Cloudflare Stream uid
  duration_seconds INTEGER,
  preview          INTEGER NOT NULL DEFAULT 0,     -- 1 = free preview
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lessons_course_pos ON lessons(course_id, position);
CREATE INDEX IF NOT EXISTS idx_lessons_module     ON lessons(module_id);

-- -------------------------------------------------------------------------
-- community_members : who has access to which community + at what tier.
-- A row exists once a wallet either pays the access price or is granted
-- access by an admin. Soft-deleted via `status` so we keep the audit trail.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id  INTEGER NOT NULL,
  wallet        TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- member|moderator|owner
  tier          TEXT,                              -- e.g. free|pro|founder
  status        TEXT NOT NULL DEFAULT 'active',   -- active|removed|banned
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at    TEXT,
  UNIQUE(community_id, wallet),
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_community_members_wallet ON community_members(wallet, status);
CREATE INDEX IF NOT EXISTS idx_community_members_role   ON community_members(community_id, role);

-- -------------------------------------------------------------------------
-- subscriptions : recurring USDC entitlements. Source of truth for
-- "is this wallet currently a paying member of community X".
--   target_type  = 'community' | 'expert' | 'course' | 'platform'
--   target_id    = numeric id (or wallet for expert)
--   period       = 'one_time' | 'monthly' | 'yearly'
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_wallet TEXT NOT NULL,
  target_type       TEXT NOT NULL,
  target_id         TEXT NOT NULL,
  amount_usdc       REAL NOT NULL,
  period            TEXT NOT NULL DEFAULT 'monthly',
  status            TEXT NOT NULL DEFAULT 'active', -- active|past_due|cancelled
  current_period_end TEXT,
  cancel_at         TEXT,
  tx_hash           TEXT,                          -- on-chain receipt for first charge
  metadata          TEXT,                          -- JSON
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_wallet  ON subscriptions(subscriber_wallet, status);
CREATE INDEX IF NOT EXISTS idx_subs_target  ON subscriptions(target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_periodend ON subscriptions(status, current_period_end);

-- -------------------------------------------------------------------------
-- referrals : two-sided wallet-to-wallet attribution.
--   referrer_wallet earns a share when referee_wallet's first qualifying
--   transaction settles. `event_*` columns capture what triggered the
--   reward so we can replay payouts without scanning the chain again.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT,                         -- short shareable code
  referrer_wallet    TEXT NOT NULL,
  referee_wallet     TEXT,                         -- NULL until claimed
  status             TEXT NOT NULL DEFAULT 'pending', -- pending|qualified|paid|void
  event_type         TEXT,                         -- 'course_purchase' | 'subscription' | …
  event_id           TEXT,
  reward_usdc        REAL DEFAULT 0,
  payout_tx_hash     TEXT,
  qualified_at       TEXT,
  paid_at            TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code     ON referrals(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer        ON referrals(referrer_wallet, status);
CREATE INDEX IF NOT EXISTS idx_referrals_referee         ON referrals(referee_wallet);

-- -------------------------------------------------------------------------
-- availability_providers : per-wallet calendar integrations. Stores the
-- minimum required to write back availability + create bookings via the
-- chosen provider. Tokens MUST be encrypted at the application layer
-- before being placed in `access_token_enc` / `refresh_token_enc`.
--   provider = 'google' | 'calendly' | 'cal_com' | 'manual'
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_providers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet              TEXT NOT NULL,
  provider            TEXT NOT NULL,
  external_account_id TEXT,
  external_calendar_id TEXT,
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  scope               TEXT,
  expires_at          TEXT,
  webhook_secret      TEXT,
  status              TEXT NOT NULL DEFAULT 'connected',  -- connected|revoked|error
  metadata            TEXT,                                -- JSON
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(wallet, provider, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_avail_wallet ON availability_providers(wallet, status);

-- -------------------------------------------------------------------------
-- bookings : add columns Phase 4 (calendar integrations) needs without
-- doing a full table rebuild. Re-running this migration after partial
-- application surfaces "duplicate column" errors which are safe to ignore.
-- -------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN provider          TEXT;
ALTER TABLE bookings ADD COLUMN external_event_id TEXT;
ALTER TABLE bookings ADD COLUMN meeting_url       TEXT;
ALTER TABLE bookings ADD COLUMN ends_at           TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_external ON bookings(provider, external_event_id);

-- -------------------------------------------------------------------------
-- siwe_sessions : (optional) audit trail of signed SIWE logins.
-- Cookies are HMAC-signed and self-contained, so this table is informational
-- only and may be skipped on read paths. Useful for revocation later.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS siwe_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet        TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  issued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_siwe_sessions_wallet ON siwe_sessions(wallet, expires_at);
