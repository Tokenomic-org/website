-- 0007_audit_log_phase3a.sql
--
-- Phase 3a: SIWE-aware admin console. The `audit_log` table was first created
-- in 0002 (admin approval workflow). Phase 3a adds `tx_hash` for on-chain
-- writes (RoleRegistry grants/revokes via the connected admin wallet) and
-- ensures the table exists if 0002 was skipped on some environment.
--
-- Apply with:
--   wrangler d1 execute tokenomic-db --file=./migrations/0007_audit_log_phase3a.sql --remote

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_wallet  TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata      TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Re-running this migration after partial application is safe; the duplicate
-- column error is caught by the migration runner and logged as a no-op.
ALTER TABLE audit_log ADD COLUMN tx_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action, created_at);
