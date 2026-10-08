ALTER TABLE `videos` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `duplicate_of_id` text REFERENCES videos(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `videos_fingerprint_idx` ON `videos` (`size_bytes`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `videos_hash_idx` ON `videos` (`content_hash`);