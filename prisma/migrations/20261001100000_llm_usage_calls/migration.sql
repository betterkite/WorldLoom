-- Additive local usage records. No World FK: deleting a world must not reset usage.
CREATE TABLE "llm_usage_calls" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputTokens" BIGINT,
    "outputTokens" BIGINT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "llm_usage_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "llm_usage_calls_status_check" CHECK ("status" IN ('pending', 'completed', 'failed')),
    CONSTRAINT "llm_usage_calls_token_pair_check" CHECK (
      ("inputTokens" IS NULL AND "outputTokens" IS NULL) OR
      ("inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL AND
       "inputTokens" >= 0 AND "outputTokens" >= 0)
    ),
    CONSTRAINT "llm_usage_calls_lifecycle_check" CHECK (
      ("status" = 'pending' AND "finishedAt" IS NULL AND
       "inputTokens" IS NULL AND "outputTokens" IS NULL) OR
      ("status" IN ('completed', 'failed') AND "finishedAt" IS NOT NULL)
    )
);

CREATE INDEX "llm_usage_calls_profileId_model_idx" ON "llm_usage_calls"("profileId", "model");
CREATE INDEX "llm_usage_calls_startedAt_idx" ON "llm_usage_calls"("startedAt");
