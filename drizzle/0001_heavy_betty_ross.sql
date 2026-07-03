ALTER TABLE `subscriptions` ADD `cancelled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `ends_on` text;