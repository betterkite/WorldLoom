ALTER TABLE "compile_runs"
ADD COLUMN "recoveryAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "semantic_index_jobs"
ADD COLUMN "recoveryAttempts" INTEGER NOT NULL DEFAULT 0;
