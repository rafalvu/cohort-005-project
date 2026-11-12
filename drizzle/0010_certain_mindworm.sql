CREATE TABLE `refund_progress_archives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refund_id` integer NOT NULL,
	`snapshot` text NOT NULL,
	`archived_at` text NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_progress_archives_refund_id_unique` ON `refund_progress_archives` (`refund_id`);--> statement-breakpoint
DROP INDEX `refunds_purchase_idx`;--> statement-breakpoint
ALTER TABLE `refunds` ADD `amount_approved` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_purchase_idx` ON `refunds` (`purchase_id`);