-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('character', 'location', 'organization', 'species', 'item', 'concept', 'rule', 'faction');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('entity_upsert', 'entity_delete', 'event_upsert', 'event_delete', 'epoch_upsert', 'epoch_delete', 'relation_upsert', 'relation_delete');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('pending', 'merged');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('error', 'warning', 'info');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'ignored', 'fixed');

-- CreateEnum
CREATE TYPE "QaStatus" AS ENUM ('archived', 'sedimented');

-- CreateTable
CREATE TABLE "worlds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "premise" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',
    "masterVersion" INTEGER NOT NULL DEFAULT 1,
    "ingestMode" TEXT NOT NULL DEFAULT 'review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epochs" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startEventUid" TEXT,
    "endEventUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epochs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "uid" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "confidence" "Confidence" NOT NULL DEFAULT 'INFERRED',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chronicle_events" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "epochUid" TEXT,
    "epochYear" INTEGER,
    "fictionPrecision" TEXT NOT NULL DEFAULT 'year',
    "sortOrder" INTEGER NOT NULL,
    "locationUid" TEXT,
    "participantUids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" "Confidence" NOT NULL DEFAULT 'INFERRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chronicle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_edges" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "causeUid" TEXT NOT NULL,
    "effectUid" TEXT NOT NULL,

    CONSTRAINT "event_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_events" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "uid" TEXT NOT NULL,
    "eventUid" TEXT,
    "subjectUid" TEXT NOT NULL,
    "objectUid" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "polarity" TEXT NOT NULL DEFAULT 'establish',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'text/markdown',
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'staged',
    "author" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changes" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "targetUid" TEXT,
    "payload" JSONB NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'local-user',
    "status" "ChangeStatus" NOT NULL DEFAULT 'pending',
    "baseVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "mergedVersion" INTEGER,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_versions" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentVersion" INTEGER,
    "summary" TEXT NOT NULL,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_records" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "targetUid" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "earlierChangeId" TEXT,
    "reason" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'latest_wins',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tombstones" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "deletedAtVersion" INTEGER NOT NULL,
    "changeId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lint_findings" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "targetUid" TEXT,
    "relatedUid" TEXT,
    "message" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lint_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_records" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "retrieval" JSONB NOT NULL,
    "sedimentStatus" "QaStatus" NOT NULL DEFAULT 'archived',
    "sedimentChangeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manuscripts" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL DEFAULT '',
    "cursorEventUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manuscripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "manuscriptId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "finalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "continuations" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "manuscriptId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "basisEventUid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedChangeUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "continuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "retrievalJson" TEXT NOT NULL DEFAULT '{}',
    "target" TEXT NOT NULL DEFAULT 'both',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_cases" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "expectedUid" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "epochs_worldId_version_idx" ON "epochs"("worldId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "epochs_worldId_version_uid_key" ON "epochs"("worldId", "version", "uid");

-- CreateIndex
CREATE INDEX "entities_worldId_version_idx" ON "entities"("worldId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "entities_worldId_version_uid_key" ON "entities"("worldId", "version", "uid");

-- CreateIndex
CREATE INDEX "chronicle_events_worldId_version_idx" ON "chronicle_events"("worldId", "version");

-- CreateIndex
CREATE INDEX "chronicle_events_worldId_version_sortOrder_idx" ON "chronicle_events"("worldId", "version", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "chronicle_events_worldId_version_uid_key" ON "chronicle_events"("worldId", "version", "uid");

-- CreateIndex
CREATE INDEX "event_edges_worldId_version_idx" ON "event_edges"("worldId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "event_edges_worldId_version_causeUid_effectUid_key" ON "event_edges"("worldId", "version", "causeUid", "effectUid");

-- CreateIndex
CREATE INDEX "relationship_events_worldId_version_idx" ON "relationship_events"("worldId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_events_worldId_version_uid_key" ON "relationship_events"("worldId", "version", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "sources_worldId_contentHash_key" ON "sources"("worldId", "contentHash");

-- CreateIndex
CREATE INDEX "changes_worldId_status_idx" ON "changes"("worldId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "world_versions_worldId_version_key" ON "world_versions"("worldId", "version");

-- CreateIndex
CREATE INDEX "conflict_records_worldId_version_idx" ON "conflict_records"("worldId", "version");

-- CreateIndex
CREATE INDEX "tombstones_worldId_uid_idx" ON "tombstones"("worldId", "uid");

-- CreateIndex
CREATE INDEX "lint_findings_worldId_version_status_idx" ON "lint_findings"("worldId", "version", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lint_findings_worldId_version_fingerprint_key" ON "lint_findings"("worldId", "version", "fingerprint");

-- CreateIndex
CREATE INDEX "qa_records_worldId_createdAt_idx" ON "qa_records"("worldId", "createdAt");

-- CreateIndex
CREATE INDEX "manuscripts_worldId_idx" ON "manuscripts"("worldId");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_manuscriptId_order_key" ON "chapters"("manuscriptId", "order");

-- CreateIndex
CREATE INDEX "continuations_worldId_status_idx" ON "continuations"("worldId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE INDEX "eval_cases_worldId_idx" ON "eval_cases"("worldId");

-- CreateIndex
CREATE INDEX "eval_runs_worldId_createdAt_idx" ON "eval_runs"("worldId", "createdAt");

-- AddForeignKey
ALTER TABLE "epochs" ADD CONSTRAINT "epochs_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chronicle_events" ADD CONSTRAINT "chronicle_events_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_edges" ADD CONSTRAINT "event_edges_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changes" ADD CONSTRAINT "changes_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_versions" ADD CONSTRAINT "world_versions_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lint_findings" ADD CONSTRAINT "lint_findings_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_records" ADD CONSTRAINT "qa_records_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "manuscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuations" ADD CONSTRAINT "continuations_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuations" ADD CONSTRAINT "continuations_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- pgvector 基础设施（Phase 4）
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS semantic_vectors (
  id TEXT PRIMARY KEY,
  "worldId" TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  target_kind TEXT NOT NULL,
  "targetUid" TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims INTEGER NOT NULL,
  embedding vector,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_semantic_vectors_lookup ON semantic_vectors ("worldId", version, target_kind);

-- 内置技能种子（C-5/能力中心；重建基线时曾丢失，已补回）
INSERT INTO skills (id, name, description, instructions, version, "retrievalJson", "target", enabled, builtin)
VALUES
  (md5(random()::text || 'grounded-lore'), 'grounded-lore', '只依据世界设定回答并逐条引用来源。', 'Prefer direct evidence from retrieved entries. State uncertainty explicitly. Cite every material claim with [n].', '1.0.0', '{}', 'both', true, true),
  (md5(random()::text || 'deep-chronicle'), 'deep-chronicle', '检索策略：深取时间线与因果边（topK=10）。', 'When answering chronology questions, expand retrieval to include causal neighbours of matched events.', '1.0.0', '{"topK":10}', 'both', true, true)
ON CONFLICT (name) DO NOTHING;
