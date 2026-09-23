-- Persist immutable content snapshots for the skill version shown in the UI.
CREATE TABLE "skill_revisions" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "retrievalJson" TEXT NOT NULL DEFAULT '{}',
    "target" TEXT NOT NULL DEFAULT 'both',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_revisions_skillId_version_key" ON "skill_revisions"("skillId", "version");
CREATE INDEX "skill_revisions_skillId_createdAt_idx" ON "skill_revisions"("skillId", "createdAt");

INSERT INTO "skill_revisions" ("id", "skillId", "version", "description", "instructions", "retrievalJson", "target", "createdAt")
SELECT
    'skillrev_' || md5(s."id" || ':' || s."version"),
    s."id",
    s."version",
    s."description",
    s."instructions",
    s."retrievalJson",
    s."target",
    s."createdAt"
FROM "skills" s
ON CONFLICT ("skillId", "version") DO NOTHING;

ALTER TABLE "skill_revisions"
  ADD CONSTRAINT "skill_revisions_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
