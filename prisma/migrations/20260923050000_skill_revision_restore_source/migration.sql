-- Preserve the immutable snapshot that a skill release was restored from.
ALTER TABLE "skill_revisions"
  ADD COLUMN "restoredFromRevisionId" TEXT;

CREATE INDEX "skill_revisions_restoredFromRevisionId_idx"
  ON "skill_revisions"("restoredFromRevisionId");

ALTER TABLE "skill_revisions"
  ADD CONSTRAINT "skill_revisions_restoredFromRevisionId_fkey"
  FOREIGN KEY ("restoredFromRevisionId") REFERENCES "skill_revisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
