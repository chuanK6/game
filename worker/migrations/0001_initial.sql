PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  member_type TEXT NOT NULL DEFAULT 'none' CHECK (member_type IN ('none', 'monthly', 'lifetime')),
  member_started_at TEXT,
  member_expire_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expire_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  cover_url TEXT NOT NULL,
  description TEXT NOT NULL,
  min_config TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(min_config)),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL DEFAULT 'free' CHECK (resource_type IN ('free', 'member')),
  resource_status TEXT NOT NULL DEFAULT 'available' CHECK (resource_status IN ('available', 'checking', 'unavailable')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'offline')),
  publish_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE game_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE game_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (game_id, tag_id)
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('add_game', 'resource_invalid', 'website', 'other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'resolved', 'closed')),
  admin_reply TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at TEXT,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE membership_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'lifetime')),
  payment_channel TEXT NOT NULL CHECK (payment_channel IN ('wechat', 'alipay')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  user_note TEXT,
  admin_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE membership_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_type TEXT NOT NULL,
  after_type TEXT NOT NULL,
  before_expire_at TEXT,
  after_expire_at TEXT,
  reason TEXT NOT NULL,
  operator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_expire ON sessions(user_id, expire_at);
CREATE INDEX idx_games_public_list ON games(status, deleted_at, publish_at DESC);
CREATE INDEX idx_games_category ON games(category_id, status, deleted_at);
CREATE INDEX idx_game_downloads_game ON game_downloads(game_id, status, sort);
CREATE INDEX idx_feedback_user_status ON feedback(user_id, status, created_at DESC);
CREATE INDEX idx_feedback_admin_queue ON feedback(status, created_at ASC);
CREATE INDEX idx_membership_orders_user ON membership_orders(user_id, submitted_at DESC);
CREATE INDEX idx_membership_orders_queue ON membership_orders(status, submitted_at ASC);
