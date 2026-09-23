/*
  Warnings:

  - You are about to drop the `semantic_vectors` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "semantic_vectors" DROP CONSTRAINT "semantic_vectors_worldId_fkey";

-- DropTable
DROP TABLE "semantic_vectors";

-- CreateTable
CREATE TABLE "foreshadows" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "plantedEventUid" TEXT,
    "resolvedEventUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foreshadows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "foreshadows_worldId_status_idx" ON "foreshadows"("worldId", "status");

-- AddForeignKey
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
