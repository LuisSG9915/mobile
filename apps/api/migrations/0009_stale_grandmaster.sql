CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_storage_stats` ADD `reserved_bytes` integer DEFAULT 0 NOT NULL;