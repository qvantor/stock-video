CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `export_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`video_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`start_sec` real NOT NULL,
	`end_sec` real NOT NULL,
	`start_frame` integer NOT NULL,
	`end_frame` integer NOT NULL,
	`motion_type` text NOT NULL,
	`status` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`failed_step` text,
	`error` text,
	`excluded` integer DEFAULT false NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`frames` text,
	`geo` text,
	`tech` text,
	`generation` text,
	`metadata` text,
	`editorial` integer,
	`user_hint` text,
	`poi_override` text,
	`step_hashes` text NOT NULL,
	`cut_path` text,
	`output_size_bytes` integer,
	`filename` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `export_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `export_clips_job_idx` ON `export_clips` (`job_id`);--> statement-breakpoint
CREATE INDEX `export_clips_status_idx` ON `export_clips` (`status`);--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`manifest_path` text NOT NULL,
	`created_at` text NOT NULL,
	`build_status` text DEFAULT 'idle' NOT NULL,
	`build_error` text,
	`archive` text,
	`archive_dir` text,
	`archive_zip` text,
	`archive_hash` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `export_jobs_project_idx` ON `export_jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `geo_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `videos` ADD `media_info` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `manual_location` text;