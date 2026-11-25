-- An unavailable judge result is not a zero score. Preserve historical rows;
-- read-side normalization distinguishes them using their original results.
ALTER TABLE "eval_runs" ALTER COLUMN "score" DROP NOT NULL;
