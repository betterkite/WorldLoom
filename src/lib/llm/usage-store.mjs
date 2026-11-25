/** Parameterized persistence shared by the runtime recorder and isolated DB
 * fixtures. No connection creation, environment access, logging or model calls.
 * The caller owns its Prisma-compatible connection and validates metadata.
 */
export function insertPendingUsage(database, attempt) {
  return database.$executeRaw`
    INSERT INTO "llm_usage_calls" ("id", "profileId", "model", "startedAt", "status")
    VALUES (${attempt.id}, ${attempt.profileId}, ${attempt.model}, ${attempt.startedAt}, 'pending')
    ON CONFLICT ("id") DO NOTHING
  `;
}

export function settleUsage(database, attempt, { finishedAt, status, inputTokens, outputTokens }) {
  return database.$executeRaw`
    INSERT INTO "llm_usage_calls"
      ("id", "profileId", "model", "startedAt", "finishedAt", "status", "inputTokens", "outputTokens")
    VALUES
      (${attempt.id}, ${attempt.profileId}, ${attempt.model}, ${attempt.startedAt}, ${finishedAt},
       ${status}, ${inputTokens}, ${outputTokens})
    ON CONFLICT ("id") DO UPDATE SET
      "finishedAt" = EXCLUDED."finishedAt", "status" = EXCLUDED."status",
      "inputTokens" = EXCLUDED."inputTokens", "outputTokens" = EXCLUDED."outputTokens"
    WHERE "llm_usage_calls"."status" = 'pending'
  `;
}

export function queryUsageGroups(database) {
  return database.$queryRaw`
    SELECT "profileId", "model", MIN("startedAt") AS "startedAt",
      COUNT(*)::text AS "calls",
      COUNT(*) FILTER (WHERE "inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL)::text AS "knownUsageCalls",
      COUNT(*) FILTER (WHERE "status" = 'pending')::text AS "pendingCalls",
      COUNT(*) FILTER (WHERE "status" = 'failed')::text AS "failedCalls",
      SUM("inputTokens")::text AS "inputTokens", SUM("outputTokens")::text AS "outputTokens"
    FROM "llm_usage_calls"
    GROUP BY "profileId", "model"
    ORDER BY "profileId", "model"
  `;
}

function unavailable() {
  return new Error('LLM usage read unavailable.');
}

/** Statistics-only deadlines, not spending limits or global pool settings.
 * The application wait observes late settlement; it cannot cancel an in-flight
 * query. PostgreSQL and Prisma own their separate transaction/query deadlines.
 */
export async function queryUsageGroupsBounded(database) {
  let timer;
  let expired = false;
  const assertActive = () => {
    if (expired) throw unavailable();
  };
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(unavailable());
      }, 7_000);
    });
    const reading = Promise.resolve().then(() =>
      database.$transaction(
        async (transaction) => {
          // Do not start another statement if acquisition or a prior SET finished
          // after our waiting deadline. Already issued statements remain SDK-owned.
          assertActive();
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
          assertActive();
          await transaction.$executeRaw`SET LOCAL statement_timeout = '3s'`;
          assertActive();
          await transaction.$executeRaw`SET LOCAL lock_timeout = '1s'`;
          assertActive();
          return queryUsageGroups(transaction);
        },
        { maxWait: 1_000, timeout: 5_000 }
      )
    );
    // Promise.race attaches handlers to both participants, including a late
    // transaction rejection after the response has already failed.
    return await Promise.race([reading, deadline]);
  } catch {
    // Do not expose SQL, connection details or a raw error/cause to the caller.
    throw unavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
