ALTER TABLE `media` ADD `is_favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `media_favorites` ON `media` (`user_id`,`is_favorite`,`deleted_at`,`taken_at`);