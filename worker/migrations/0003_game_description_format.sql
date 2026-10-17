ALTER TABLE games ADD COLUMN description_format TEXT NOT NULL DEFAULT 'plain'
  CHECK (description_format IN ('plain', 'markdown'));
