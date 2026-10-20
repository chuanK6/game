ALTER TABLE users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0 CHECK (is_super IN (0, 1));
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- One-time bootstrap only. Runtime authorization uses is_super, never usernames.
UPDATE users SET is_super = 1, role = 'admin', status = 'active', updated_at = CURRENT_TIMESTAMP
WHERE username = 's0xu' COLLATE NOCASE AND deleted_at IS NULL;

CREATE INDEX idx_users_management ON users(deleted_at, role, status, created_at, id);

-- Keep the protected identity intact even if another write path is introduced.
CREATE TRIGGER protect_super_user
BEFORE UPDATE OF is_super, role, status, deleted_at ON users
WHEN OLD.is_super = 1 AND (NEW.is_super <> 1 OR NEW.role <> 'admin' OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'SUPER_USER_PROTECTED');
END;

CREATE TRIGGER prevent_super_user_delete
BEFORE DELETE ON users WHEN OLD.is_super = 1
BEGIN
  SELECT RAISE(ABORT, 'SUPER_USER_PROTECTED');
END;
