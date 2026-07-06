ALTER TABLE `subscriptions` ADD `prepaid` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `depletes_on` text;