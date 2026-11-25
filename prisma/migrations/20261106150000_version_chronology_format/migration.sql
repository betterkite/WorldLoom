-- Add an interpretation marker only. Never rewrite historical content or sort keys.
-- Older applications omit this column and continue producing legacy snapshots.
ALTER TABLE "world_versions" ADD COLUMN "chronologyFormat" TEXT NOT NULL DEFAULT 'legacy';
