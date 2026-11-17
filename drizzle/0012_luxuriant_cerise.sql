CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_id` integer NOT NULL,
	`source_event_key` text NOT NULL,
	`kind` text NOT NULL,
	`lesson_id` integer,
	`question_id` integer,
	`reply_id` integer,
	`refund_request_id` integer,
	`purchase_id` integer,
	`team_id` integer,
	`seat_id` integer,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refund_request_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_created_utc" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', "notifications"."created_at") IS NOT NULL AND "notifications"."created_at" = strftime('%Y-%m-%dT%H:%M:%fZ', "notifications"."created_at")),
	CONSTRAINT "notifications_read_utc" CHECK("notifications"."read_at" IS NULL OR (strftime('%Y-%m-%dT%H:%M:%fZ', "notifications"."read_at") IS NOT NULL AND "notifications"."read_at" = strftime('%Y-%m-%dT%H:%M:%fZ', "notifications"."read_at"))),
	CONSTRAINT "notifications_event_key" CHECK(length(trim("notifications"."source_event_key")) > 0),
	CONSTRAINT "notifications_context" CHECK(
    ("notifications"."kind" IN ('question_created', 'reply_created') AND "notifications"."lesson_id" IS NOT NULL AND "notifications"."question_id" IS NOT NULL
      AND (("notifications"."kind" = 'question_created' AND "notifications"."reply_id" IS NULL) OR ("notifications"."kind" = 'reply_created' AND "notifications"."reply_id" IS NOT NULL))
      AND "notifications"."refund_request_id" IS NULL AND "notifications"."purchase_id" IS NULL AND "notifications"."team_id" IS NULL AND "notifications"."seat_id" IS NULL)
    OR ("notifications"."kind" IN ('refund_requested', 'refund_approved', 'refund_declined') AND "notifications"."refund_request_id" IS NOT NULL AND "notifications"."purchase_id" IS NOT NULL
      AND "notifications"."lesson_id" IS NULL AND "notifications"."question_id" IS NULL AND "notifications"."reply_id" IS NULL AND "notifications"."team_id" IS NULL AND "notifications"."seat_id" IS NULL)
    OR ("notifications"."kind" = 'seat_claimed' AND "notifications"."team_id" IS NOT NULL AND "notifications"."seat_id" IS NOT NULL
      AND "notifications"."lesson_id" IS NULL AND "notifications"."question_id" IS NULL AND "notifications"."reply_id" IS NULL AND "notifications"."refund_request_id" IS NULL AND "notifications"."purchase_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_recipient_idx` ON `notifications` (`source_event_key`,`recipient_id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_order_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_unread_order_idx` ON `notifications` (`recipient_id`,`created_at`,`id`) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX `notifications_expiry_idx` ON `notifications` (`created_at`);