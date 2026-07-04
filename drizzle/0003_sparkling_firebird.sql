CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`paid_on` text NOT NULL,
	`amount` real NOT NULL,
	`currency_code` text NOT NULL,
	`amount_base` real NOT NULL,
	`base_currency` text NOT NULL,
	`fx_rate` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payments_subscription` ON `payments` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_paid_on` ON `payments` (`paid_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_payments_sub_date` ON `payments` (`subscription_id`,`paid_on`);