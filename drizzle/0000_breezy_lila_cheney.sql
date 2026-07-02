CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`code` text PRIMARY KEY NOT NULL,
	`rate_to_base` real NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`url` text,
	`price` real NOT NULL,
	`currency_code` text DEFAULT 'GBP' NOT NULL,
	`billing_cycle` text DEFAULT 'month' NOT NULL,
	`billing_interval` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`trial_end_date` text,
	`category_id` integer,
	`payment_method_id` integer,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`notify` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_active` ON `subscriptions` (`active`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_category` ON `subscriptions` (`category_id`);