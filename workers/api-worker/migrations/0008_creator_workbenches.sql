-- 0008_creator_workbenches.sql
--
-- Phase 3b — Educator + Consultant dashboards (creator workbenches).
--
-- Adds:
--   * `services`            — consultant service catalog (e.g. "30-min review — 50 USDC")
--   * `availability_slots`  — Phase-4 stub holder for consultant calendar windows
--   * extends `bookings` with escrow_status / escrow_tx / service_id
--   * extends `articles`   with paywall + scheduled_publish_at
--   * extends `enrollments` with completed_at + last_seen_at
--   * `certificate_mints`   — log of CertificateNFT.mintBatch tx hashes per (educator, course)
--
-- Apply with:
--   wrangler d1 execute tokenomic-db --file=./migrations/0008_creator_workbenches.sql --remote

CREATE TABLE IF NOT EXISTS services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_wallet TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  duration_min    INTEGER NOT NULL DEFAULT 30,
  price_usdc      REAL NOT NULL DEFAULT 0,
  category        TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- active|draft|archived
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_services_consultant ON services(consultant_wallet, status);

CREATE TABLE IF NOT EXISTS availability_slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_wallet TEXT NOT NULL,
  weekday         INTEGER NOT NULL,                -- 0..6 (Sun..Sat)
  start_min       INTEGER NOT NULL,                -- minutes from 00:00 UTC
  end_min         INTEGER NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_avail_consultant ON availability_slots(consultant_wallet, weekday);

-- Bookings: extend for BookingEscrow lifecycle. SQLite/D1 ignores duplicate
-- column adds via the migration runner's catch-all, so re-running is safe.
ALTER TABLE bookings ADD COLUMN service_id INTEGER;
ALTER TABLE bookings ADD COLUMN escrow_status TEXT DEFAULT 'none';   -- none|held|released|disputed|refunded
ALTER TABLE bookings ADD COLUMN escrow_tx TEXT;

ALTER TABLE articles ADD COLUMN paywalled INTEGER DEFAULT 0;          -- 0=public, 1=members
ALTER TABLE articles ADD COLUMN scheduled_publish_at TEXT;            -- iso8601 | null

ALTER TABLE enrollments ADD COLUMN completed_at TEXT;
ALTER TABLE enrollments ADD COLUMN last_seen_at TEXT;

CREATE TABLE IF NOT EXISTS certificate_mints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  educator_wallet TEXT NOT NULL,
  course_id       INTEGER NOT NULL,
  recipient_wallet TEXT NOT NULL,
  token_id        INTEGER,
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'submitted',                  -- submitted|confirmed|failed
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_certmints_educator ON certificate_mints(educator_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_certmints_course ON certificate_mints(course_id);
