-- Durable background semantic-index refreshes.

CREATE TYPE "SemanticIndexJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "semantic_index_jobs" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SemanticIndexJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "indexed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_index_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "semantic_index_jobs_worldId_version_key"
  ON "semantic_index_jobs"("worldId", "version");
CREATE INDEX "semantic_index_jobs_worldId_status_idx"
  ON "semantic_index_jobs"("worldId", "status");

ALTER TABLE "semantic_index_jobs"
  ADD CONSTRAINT "semantic_index_jobs_worldId_fkey"
  FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
