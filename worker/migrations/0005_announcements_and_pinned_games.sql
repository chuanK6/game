ALTER TABLE games ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));
CREATE INDEX idx_games_pinned_published ON games(status, deleted_at, is_pinned DESC, publish_at DESC, id DESC);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 30000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  show_popup INTEGER NOT NULL DEFAULT 1 CHECK (show_popup IN (0, 1))
);
CREATE INDEX idx_announcements_status_created ON announcements(status, created_at DESC, id DESC);
