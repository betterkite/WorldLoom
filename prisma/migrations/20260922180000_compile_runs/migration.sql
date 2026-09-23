-- ISS-31 / P0-1: durable, resumable compiler runs and chunk checkpoints.

CREATE TYPE "CompileRunKind" AS ENUM ('source', 'chapter');

CREATE TYPE "CompileRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

CREATE TYPE "CompileChunkStatus" AS ENUM ('pending', 'analyzing', 'generating', 'completed', 'failed');

CREATE TABLE "compile_runs" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "kind" "CompileRunKind" NOT NULL,
    "sourceId" TEXT,
    "chapterId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "completedChunks" INTEGER NOT NULL DEFAULT 0,
    "status" "CompileRunStatus" NOT NULL DEFAULT 'queued',
    "batchId" TEXT,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compile_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compile_chunks" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "CompileChunkStatus" NOT NULL DEFAULT 'pending',
    "analysis" JSONB,
    "generated" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compile_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compile_runs_worldId_status_idx" ON "compile_runs"("worldId", "status");
CREATE INDEX "compile_runs_worldId_sourceId_sourceHash_idx" ON "compile_runs"("worldId", "sourceId", "sourceHash");
CREATE INDEX "compile_runs_worldId_chapterId_sourceHash_idx" ON "compile_runs"("worldId", "chapterId", "sourceHash");
CREATE UNIQUE INDEX "compile_chunks_runId_index_key" ON "compile_chunks"("runId", "index");
CREATE INDEX "compile_chunks_runId_status_idx" ON "compile_chunks"("runId", "status");

ALTER TABLE "compile_runs"
  ADD CONSTRAINT "compile_runs_worldId_fkey"
  FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compile_chunks"
  ADD CONSTRAINT "compile_chunks_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "compile_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
