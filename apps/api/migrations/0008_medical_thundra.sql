ALTER TABLE `media` ADD `is_screenshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `is_document` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_media_screenshot` ON `media` (`user_id`,`is_screenshot`);--> statement-breakpoint
CREATE INDEX `idx_media_document` ON `media` (`user_id`,`is_document`);