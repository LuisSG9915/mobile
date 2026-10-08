CREATE TABLE `album` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`cover_media_id` text,
	`share_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_album_user` ON `album` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_album_share_token` ON `album` (`share_token`);--> statement-breakpoint
CREATE TABLE `album_media` (
	`album_id` text NOT NULL,
	`media_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`album_id`, `media_id`),
	FOREIGN KEY (`album_id`) REFERENCES `album`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_album_media_album` ON `album_media` (`album_id`,`added_at`);--> statement-breakpoint
CREATE INDEX `idx_album_media_media` ON `album_media` (`media_id`);