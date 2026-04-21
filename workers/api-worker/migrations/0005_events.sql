-- 0005_events.sql — Native first-party events (replaces Luma proxy).

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT UNIQUE,
  host_wallet     TEXT NOT NULL,
  host_name       TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  starts_at       TEXT NOT NULL,           -- ISO 8601, UTC recommended
  ends_at         TEXT,                    -- ISO 8601 (optional)
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  location        TEXT,                    -- physical location text
  meeting_url     TEXT,                    -- video conf / livestream URL
  cover_url       TEXT,
  capacity        INTEGER,                 -- NULL = unlimited
  rsvp_count      INTEGER NOT NULL DEFAULT 0,   -- "going" only
  status          TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|cancelled
  visibility      TEXT NOT NULL DEFAULT 'public',    -- public|unlisted|private
  community_id    INTEGER,                 -- optional FK
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_host          ON events(host_wallet);
CREATE INDEX IF NOT EXISTS idx_events_starts_at     ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status_starts ON events(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_community     ON events(community_id);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL,
  wallet      TEXT NOT NULL,
  name        TEXT,
  email       TEXT,
  status      TEXT NOT NULL DEFAULT 'going',  -- going|cancelled|waitlist
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_rsvps_event_status ON event_rsvps(event_id, status);
CREATE INDEX IF NOT EXISTS idx_rsvps_wallet       ON event_rsvps(wallet);
