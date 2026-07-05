CREATE TABLE `contexts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `context_id` integer REFERENCES contexts(id);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_context` ON `subscriptions` (`context_id`);