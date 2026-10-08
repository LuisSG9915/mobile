ALTER TABLE `media` ADD `city` text;--> statement-breakpoint
ALTER TABLE `media` ADD `country` text;--> statement-breakpoint
ALTER TABLE `media` ADD `location_name` text;--> statement-breakpoint
CREATE INDEX `idx_media_city` ON `media` (`user_id`,`city`);
