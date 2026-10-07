CREATE TABLE `user_storage_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`max_bytes` integer DEFAULT 10737418240 NOT NULL,
	`media_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `media` ADD `date_group` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `media` SET `date_group` = strftime('%Y-%m-%d', `taken_at` / 1000, 'unixepoch') WHERE `date_group` = '';--> statement-breakpoint
CREATE INDEX `idx_media_date_group` ON `media` (`user_id`,`date_group`);