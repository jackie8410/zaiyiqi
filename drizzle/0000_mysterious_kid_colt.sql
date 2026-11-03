CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`theme` text NOT NULL,
	`mode` text NOT NULL,
	`pages` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`share_token` text,
	`password_hash` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`sources` text NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`charged` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`owner` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`product` text NOT NULL,
	`channel` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`transaction_id` text,
	`created` integer NOT NULL,
	`paid` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_transaction_id_unique` ON `orders` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`owner` text NOT NULL,
	`score` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `share_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`credits` integer DEFAULT 2 NOT NULL,
	`pro_until` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
