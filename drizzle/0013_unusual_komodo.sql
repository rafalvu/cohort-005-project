ALTER TABLE `comments` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `operation_fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `comments_actor_operation_idx` ON `comments` (`user_id`,`operation_id`);