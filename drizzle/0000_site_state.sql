CREATE TABLE `site_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `data` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);
