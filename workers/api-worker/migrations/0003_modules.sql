-- Course modules: each course is a list of ordered markdown lessons,
-- optionally with a Cloudflare Stream video uid for the embedded player.
CREATE TABLE IF NOT EXISTS modules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id        INTEGER NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  title            TEXT NOT NULL,
  body_md          TEXT,
  video_uid        TEXT,
  duration_minutes INTEGER,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_modules_course_pos ON modules(course_id, position);
