CREATE TABLE `media_tags` (
	`media_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`media_id`, `tag`),
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_tags_user_tag` ON `media_tags` (`user_id`,`tag`,`media_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `media_fts` USING fts5(
	media_id UNINDEXED,
	user_id UNINDEXED,
	caption,
	tags,
	city,
	country,
	location_name,
	ext,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE INDEX `idx_media_timeline_active` ON `media`(`user_id`, `taken_at` DESC, `id` DESC) WHERE `status` = 'ready' AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_media_user_month_day` ON `media`(`user_id`, substr(`date_group`, 6, 5), `taken_at` DESC, `id` DESC) WHERE `status` = 'ready' AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_media_places` ON `media`(`user_id`, `city`, `country`) WHERE `status` = 'ready' AND `deleted_at` IS NULL AND `city` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_media_locations` ON `media`(`user_id`, `latitude`, `longitude`, `taken_at` DESC) WHERE `status` = 'ready' AND `deleted_at` IS NULL AND `latitude` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `media_ai` AFTER INSERT ON `media`
WHEN new.status = 'ready' AND new.deleted_at IS NULL BEGIN
  INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext)
  VALUES (new.id, new.user_id, coalesce(new.caption, ''), coalesce(new.tags, ''), coalesce(new.city, ''), coalesce(new.country, ''), coalesce(new.location_name, ''), new.ext);

  INSERT OR IGNORE INTO `media_tags` (media_id, user_id, tag)
  SELECT new.id, new.user_id, lower(trim(json_each.value))
  FROM json_each(new.tags)
  WHERE new.tags IS NOT NULL AND json_valid(new.tags) AND trim(json_each.value) != '';
END;
--> statement-breakpoint
CREATE TRIGGER `media_au` AFTER UPDATE ON `media` BEGIN
  DELETE FROM `media_fts` WHERE media_id = old.id;
  DELETE FROM `media_tags` WHERE media_id = old.id;

  INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext)
  SELECT new.id, new.user_id, coalesce(new.caption, ''), coalesce(new.tags, ''), coalesce(new.city, ''), coalesce(new.country, ''), coalesce(new.location_name, ''), new.ext
  WHERE new.status = 'ready' AND new.deleted_at IS NULL;

  INSERT OR IGNORE INTO `media_tags` (media_id, user_id, tag)
  SELECT new.id, new.user_id, lower(trim(json_each.value))
  FROM json_each(new.tags)
  WHERE new.status = 'ready' AND new.deleted_at IS NULL AND new.tags IS NOT NULL AND json_valid(new.tags) AND trim(json_each.value) != '';
END;
--> statement-breakpoint
CREATE TRIGGER `media_ad` AFTER DELETE ON `media` BEGIN
  DELETE FROM `media_fts` WHERE media_id = old.id;
  DELETE FROM `media_tags` WHERE media_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `media_fts` (media_id, user_id, caption, tags, city, country, location_name, ext)
SELECT id, user_id, coalesce(caption, ''), coalesce(tags, ''), coalesce(city, ''), coalesce(country, ''), coalesce(location_name, ''), ext
FROM `media`
WHERE status = 'ready' AND deleted_at IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `media_tags` (media_id, user_id, tag)
SELECT `media`.id, `media`.user_id, lower(trim(json_each.value))
FROM `media`, json_each(`media`.tags)
WHERE `media`.status = 'ready' AND `media`.deleted_at IS NULL AND `media`.tags IS NOT NULL AND json_valid(`media`.tags) AND trim(json_each.value) != '';