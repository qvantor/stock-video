CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`analysis_settings` text NOT NULL,
	`manifest_path` text
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`start_sec` real NOT NULL,
	`end_sec` real NOT NULL,
	`motion_type` text NOT NULL,
	`score` real NOT NULL,
	`reasons` text NOT NULL,
	`origin` text NOT NULL,
	`accepted` integer NOT NULL,
	`edited` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_video_idx` ON `segments` (`video_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`upload_id` text,
	`original_filename` text NOT NULL,
	`stored_path` text,
	`size_bytes` integer NOT NULL,
	`duration_sec` real,
	`fps` real,
	`width` integer,
	`height` integer,
	`codec` text,
	`has_proxy` integer DEFAULT false NOT NULL,
	`sprite_meta` text,
	`status` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `videos_project_idx` ON `videos` (`project_id`);--> statement-breakpoint
CREATE INDEX `videos_upload_idx` ON `videos` (`upload_id`);