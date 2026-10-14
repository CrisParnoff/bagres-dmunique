CREATE TABLE `admin_attempts` (
  `client_key` text PRIMARY KEY NOT NULL,
  `failures` integer NOT NULL DEFAULT 0,
  `locked_until` integer NOT NULL DEFAULT 0
);
