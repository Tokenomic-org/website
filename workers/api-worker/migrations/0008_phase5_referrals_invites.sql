-- 0008_phase5_referrals_invites.sql
--
-- Phase 5 — Referrals & contact import.
--
-- Adds the columns and tables needed to:
--   1) Resolve `/r/<handle>` to a referrer wallet, set a tk_ref cookie,
--      and persist the (referrer, referee) link on first SIWE sign-in.
--   2) Send rate-limited, Turnstile-gated invite emails carrying a
--      one-time HMAC-signed token, with per-recipient suppression for
--      unsubscribes / bounces.
--
-- The `referrals` table already exists from migration 0006. We add the
-- `linked_at` column for "first SIWE consumed the cookie" timestamps,
-- and an idempotency unique index so a referee can never have two
-- referrers (matches the on-chain `ReferralRegistry` invariant).
--
-- Apply with:
--   wrangler d1 execute tokenomic-db --file=./migrations/0008_phase5_referrals_invites.sql --remote
-- ----------------------------------------------------------------------

-- Idempotent column add. SQLite does not support `IF NOT EXISTS` on
-- ALTER TABLE ADD COLUMN; rerunning surfaces a "duplicate column" error
-- which is safe to ignore.
ALTER TABLE referrals ADD COLUMN linked_at    TEXT;
ALTER TABLE referrals ADD COLUMN source       TEXT;     -- 'cookie' | 'invite' | 'manual' | 'on-chain'
ALTER TABLE referrals ADD COLUMN link_tx_hash TEXT;     -- ReferralRegistry.setReferrer tx hash

-- One referee can only have one referrer (mirrors ReferralRegistry).
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referee_unique
  ON referrals(referee_wallet) WHERE referee_wallet IS NOT NULL;

-- Sent invitations. The HMAC-signed token is NOT stored — we store
-- only its first 16 hex chars as a lookup key (`token_prefix`) and
-- recompute/compare in /api/invites/* handlers. This keeps a leaked
-- D1 dump from being directly usable to accept invites.
CREATE TABLE IF NOT EXISTS invites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_wallet   TEXT NOT NULL,                      -- lc(0x…)
  email           TEXT NOT NULL,                      -- lc, normalized
  name            TEXT,                               -- as supplied by sender
  message         TEXT,                               -- optional personal note
  source          TEXT NOT NULL DEFAULT 'manual',     -- 'csv'|'google'|'microsoft'|'manual'
  token_prefix    TEXT NOT NULL,                      -- first 16 hex of HMAC
  status          TEXT NOT NULL DEFAULT 'queued',     -- queued|sent|delivered|bounced|opened|clicked|accepted|failed
  delivery_error  TEXT,
  sent_at         TEXT,
  opened_at       TEXT,
  clicked_at      TEXT,
  accepted_wallet TEXT,                               -- set when invitee binds a wallet
  accepted_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_sender  ON invites(sender_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_email   ON invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_token   ON invites(token_prefix);
-- Same sender cannot spam the same email more than once per 24h batch.
-- Enforced at app layer; index supports the lookup.
CREATE INDEX IF NOT EXISTS idx_invites_dedupe  ON invites(sender_wallet, email, created_at DESC);

-- Suppression list. Any (email, reason) pair here blocks future sends.
-- `wallet` is set when the suppression came from an authenticated
-- "remove me" action; for anonymous unsubscribe links it stays NULL.
CREATE TABLE IF NOT EXISTS invite_suppressions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  wallet      TEXT,
  reason      TEXT NOT NULL DEFAULT 'unsubscribe', -- 'unsubscribe'|'bounce'|'complaint'|'admin'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppress_wallet ON invite_suppressions(wallet);
