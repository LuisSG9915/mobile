-- 1. Columna geohash indexada para clustering espacial en O(1)
ALTER TABLE `media` ADD COLUMN `geohash` text;

CREATE INDEX IF NOT EXISTS `idx_media_user_geohash`
  ON `media` (`user_id`, `deleted_at`, `geohash`)
  WHERE `geohash` IS NOT NULL AND `deleted_at` IS NULL;

-- 2. Tabla de etiquetas generadas por IA (si no existe) para sincronizar FTS
CREATE TABLE IF NOT EXISTS `media_ai_tags` (
  `media_id` text NOT NULL,
  `tag` text NOT NULL,
  PRIMARY KEY(`media_id`, `tag`),
  FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE
);

-- 3. Tabla virtual FTS5 (reemplaza la anterior para unificar esquema)
DROP TRIGGER IF EXISTS `media_ai`;
DROP TRIGGER IF EXISTS `media_au`;
DROP TRIGGER IF EXISTS `media_ad`;
DROP TRIGGER IF EXISTS `trg_media_fts_insert`;
DROP TRIGGER IF EXISTS `trg_media_fts_update`;
DROP TRIGGER IF EXISTS `trg_media_fts_delete`;
DROP TRIGGER IF EXISTS `trg_media_ai_tags_fts_sync`;
DROP TABLE IF EXISTS `media_fts`;

CREATE VIRTUAL TABLE `media_fts` USING fts5(
  media_id UNINDEXED,
  user_id UNINDEXED,
  caption,
  tags,
  city,
  country,
  location_name,
  ext,
  ai_tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- 4. Triggers de sincronización sobre media
CREATE TRIGGER `trg_media_fts_insert`
AFTER INSERT ON `media`
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext, ai_tags)
  VALUES (
    NEW.id,
    NEW.user_id,
    COALESCE(NEW.caption, ''),
    COALESCE(NEW.tags, ''),
    COALESCE(NEW.city, ''),
    COALESCE(NEW.country, ''),
    COALESCE(NEW.location_name, ''),
    COALESCE(NEW.ext, ''),
    COALESCE((SELECT GROUP_CONCAT(t.tag, ' ') FROM `media_ai_tags` t WHERE t.media_id = NEW.id), '')
  );

  INSERT OR IGNORE INTO `media_tags` (media_id, user_id, tag)
  SELECT NEW.id, NEW.user_id, lower(trim(json_each.value))
  FROM json_each(NEW.tags)
  WHERE NEW.tags IS NOT NULL AND json_valid(NEW.tags) AND trim(json_each.value) != '';
END;

CREATE TRIGGER `trg_media_fts_update`
AFTER UPDATE ON `media`
BEGIN
  DELETE FROM `media_fts` WHERE media_id = OLD.id;
  INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext, ai_tags)
  SELECT
    NEW.id,
    NEW.user_id,
    COALESCE(NEW.caption, ''),
    COALESCE(NEW.tags, ''),
    COALESCE(NEW.city, ''),
    COALESCE(NEW.country, ''),
    COALESCE(NEW.location_name, ''),
    COALESCE(NEW.ext, ''),
    COALESCE((SELECT GROUP_CONCAT(t.tag, ' ') FROM `media_ai_tags` t WHERE t.media_id = NEW.id), '')
  WHERE NEW.deleted_at IS NULL;

  DELETE FROM `media_tags` WHERE media_id = OLD.id;
  INSERT OR IGNORE INTO `media_tags` (media_id, user_id, tag)
  SELECT NEW.id, NEW.user_id, lower(trim(json_each.value))
  FROM json_each(NEW.tags)
  WHERE NEW.status = 'ready' AND NEW.deleted_at IS NULL AND NEW.tags IS NOT NULL AND json_valid(NEW.tags) AND trim(json_each.value) != '';
END;

CREATE TRIGGER `trg_media_fts_delete`
AFTER DELETE ON `media`
BEGIN
  DELETE FROM `media_fts` WHERE media_id = OLD.id;
  DELETE FROM `media_tags` WHERE media_id = OLD.id;
END;

-- 5. Trigger de sincronización sobre media_ai_tags
CREATE TRIGGER `trg_media_ai_tags_fts_sync`
AFTER INSERT ON `media_ai_tags`
BEGIN
  DELETE FROM `media_fts` WHERE media_id = NEW.media_id;
  INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext, ai_tags)
  SELECT
    m.id,
    m.user_id,
    COALESCE(m.caption, ''),
    COALESCE(m.tags, ''),
    COALESCE(m.city, ''),
    COALESCE(m.country, ''),
    COALESCE(m.location_name, ''),
    COALESCE(m.ext, ''),
    COALESCE((SELECT GROUP_CONCAT(t.tag, ' ') FROM `media_ai_tags` t WHERE t.media_id = m.id), '')
  FROM `media` m
  WHERE m.id = NEW.media_id AND m.deleted_at IS NULL;
END;

-- 6. Repoblar índice inicial
INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext, ai_tags)
SELECT
  m.id,
  m.user_id,
  COALESCE(m.caption, ''),
  COALESCE(m.tags, ''),
  COALESCE(m.city, ''),
  COALESCE(m.country, ''),
  COALESCE(m.location_name, ''),
  COALESCE(m.ext, ''),
  COALESCE((SELECT GROUP_CONCAT(t.tag, ' ') FROM `media_ai_tags` t WHERE t.media_id = m.id), '')
FROM `media` m
WHERE m.deleted_at IS NULL;
