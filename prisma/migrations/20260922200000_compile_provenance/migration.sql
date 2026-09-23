-- ISS-33 / P0-3: persist source references and compile-run provenance.

ALTER TABLE "epochs"
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "chronicle_events"
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "relationship_events"
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "changes"
  ADD COLUMN "provenance" JSONB;

ALTER TABLE "compile_runs"
  ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'compile-v1',
  ADD COLUMN "profileId" TEXT,
  ADD COLUMN "model" TEXT;

ALTER TABLE "compile_chunks"
  ADD COLUMN "sourceStart" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceEnd" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "analysisMeta" JSONB,
  ADD COLUMN "generationMeta" JSONB;
