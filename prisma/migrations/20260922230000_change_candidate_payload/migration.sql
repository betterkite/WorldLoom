-- Preserve the original compiler/manual candidate so review can distinguish it
-- from a later reviewer edit to Change.payload.
ALTER TABLE "changes"
  ADD COLUMN "candidatePayload" JSONB;
