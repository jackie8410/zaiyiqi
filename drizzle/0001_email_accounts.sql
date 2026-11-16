CREATE TABLE `account_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_sessions_user` ON `account_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`application` text DEFAULT '' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`verified_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_accounts_status" CHECK("email_accounts"."status" IN ('pending','approved','rejected','suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_accounts_email_unique` ON `email_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `email_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`application` text DEFAULT '' NOT NULL,
	`expires` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed` integer,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_codes_expiry` ON `email_codes` (`expires`);