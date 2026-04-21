-- Tokenomic D1 initial schema (replaces Supabase Postgres)
-- Apply with: wrangler d1 execute tokenomic-db --file=./migrations/0001_init.sql --remote

CREATE TABLE IF NOT EXISTS profiles (
  wallet_address TEXT PRIMARY KEY,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  bio TEXT,
  specialty TEXT,
  avatar_url TEXT,
  rate_30 INTEGER,
  rate_60 INTEGER,
  sessions INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  xp INTEGER DEFAULT 0,
  approved INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role, approved);

CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  educator_wallet TEXT NOT NULL,
  educator_name TEXT,
  category TEXT,
  level TEXT,
  access_price_usdc REAL DEFAULT 0,
  members_count INTEGER DEFAULT 0,
  courses_count INTEGER DEFAULT 0,
  thumbnail_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_communities_educator ON communities(educator_wallet);
CREATE INDEX IF NOT EXISTS idx_communities_status ON communities(status);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  educator_wallet TEXT NOT NULL,
  educator_name TEXT,
  community_id INTEGER,
  category TEXT,
  level TEXT,
  price_usdc REAL DEFAULT 0,
  modules_count INTEGER DEFAULT 0,
  enrolled_count INTEGER DEFAULT 0,
  estimated_hours INTEGER,
  what_you_learn TEXT,
  thumbnail_url TEXT,
  stream_video_uid TEXT,
  status TEXT DEFAULT 'active',
  on_chain_course_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courses_educator ON courses(educator_wallet);
CREATE INDEX IF NOT EXISTS idx_courses_community ON courses(community_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT,
  category TEXT,
  author_wallet TEXT,
  author_name TEXT,
  author_avatar TEXT,
  image_url TEXT,
  reading_time INTEGER,
  status TEXT DEFAULT 'published',
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  student_wallet TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  enrolled_at TEXT DEFAULT (datetime('now')),
  UNIQUE(course_id, student_wallet)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_wallet TEXT NOT NULL,
  client_wallet TEXT,
  client_name TEXT,
  topic TEXT,
  booking_date TEXT,
  time_slot TEXT,
  duration INTEGER,
  price_usdc REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_consultant ON bookings(consultant_wallet, booking_date);

CREATE TABLE IF NOT EXISTS revenue_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT UNIQUE,
  amount_usdc REAL,
  sender_wallet TEXT,
  recipient_wallet TEXT,
  description TEXT,
  status TEXT DEFAULT 'confirmed',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revenue_recipient ON revenue_tx(recipient_wallet, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL,
  author_wallet TEXT NOT NULL,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_community ON messages(community_id, created_at);
