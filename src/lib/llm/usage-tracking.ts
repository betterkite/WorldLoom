import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import {
  llmUsageSummarySchema,
  type LlmUsageCounters,
  type LlmUsageSummary
} from './usage-summary';
import { insertPendingUsage, queryUsageGroupsBounded, settleUsage } from './usage-store.mjs';

export type LlmUsageAttempt = {
  id: string;
  profileId: string;
  model: string;
  startedAt: Date;
};
type TokenUsage = { inputTokens: number; outputTokens: number } | null;
const WRITE_WAIT_MS = 1_000;
let writeFailures = BigInt(0);

/** Statistics are observational: unavailable storage must not create a spending
 * cap or replace a successful completion with a tracking failure. Late writes
 * may finish after the bounded wait; SQL upserts cannot regress a finished row.
 */
async function observeWrite(write: () => PromiseLike<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    Promise.resolve()
      .then(write)
      .then(
        () => true,
        () => false
      ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), WRITE_WAIT_MS);
    })
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (!result) {
    writeFailures += BigInt(1);
    // No SQL arguments, prompts, credentials, paths or raw errors in this log.
    console.warn('[llm-usage] usage_recording_unavailable');
  }
}

export async function beginLlmUsageAttempt(profile: {
  id: string;
  model: string;
}): Promise<LlmUsageAttempt> {
  const attempt = {
    id: randomUUID(),
    profileId: profile.id,
    model: profile.model,
    startedAt: new Date()
  };
  await observeWrite(() => insertPendingUsage(prisma, attempt));
  return attempt;
}

export async function finishLlmUsageAttempt(
  attempt: LlmUsageAttempt,
  usage: TokenUsage,
  completed: boolean
): Promise<void> {
  const known = Boolean(
    usage &&
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0
  );
  const input = known && usage ? BigInt(usage.inputTokens) : null;
  const output = known && usage ? BigInt(usage.outputTokens) : null;
  const status = completed ? 'completed' : 'failed';
  const finishedAt = new Date();
  await observeWrite(() =>
    settleUsage(prisma, attempt, {
      finishedAt,
      status,
      inputTokens: input,
      outputTokens: output
    })
  );
}

type AggregateRow = {
  profileId: string;
  model: string;
  startedAt: Date;
  calls: string;
  knownUsageCalls: string;
  pendingCalls: string;
  failedCalls: string;
  inputTokens: string | null;
  outputTokens: string | null;
};

function counters(row: AggregateRow): LlmUsageCounters {
  return {
    calls: row.calls,
    knownUsageCalls: row.knownUsageCalls,
    unknownUsageCalls: (BigInt(row.calls) - BigInt(row.knownUsageCalls)).toString(),
    pendingCalls: row.pendingCalls,
    failedCalls: row.failedCalls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens:
      row.inputTokens === null || row.outputTokens === null
        ? null
        : (BigInt(row.inputTokens) + BigInt(row.outputTokens)).toString()
  };
}

/** One aggregate-only SQL read in a bounded read-only transaction: no full-row
 * payloads, provider probes or spending limits. Failure never becomes zero use.
 */
export async function readLlmUsageSummary(): Promise<LlmUsageSummary> {
  const rows: AggregateRow[] = await queryUsageGroupsBounded(prisma);
  const profiles = rows.map((row) => ({
    profileId: row.profileId,
    model: row.model,
    ...counters(row)
  }));
  const sum = (key: keyof LlmUsageCounters) =>
    profiles.reduce((total, profile) => total + BigInt(profile[key] ?? '0'), BigInt(0)).toString();
  const known = sum('knownUsageCalls');
  const totals: LlmUsageCounters = {
    calls: sum('calls'),
    knownUsageCalls: known,
    unknownUsageCalls: sum('unknownUsageCalls'),
    pendingCalls: sum('pendingCalls'),
    failedCalls: sum('failedCalls'),
    inputTokens: known === '0' ? null : sum('inputTokens'),
    outputTokens: known === '0' ? null : sum('outputTokens'),
    totalTokens: known === '0' ? null : sum('totalTokens')
  };
  const first = rows.reduce<Date | null>(
    (earliest, row) => (!earliest || row.startedAt < earliest ? row.startedAt : earliest),
    null
  );
  return llmUsageSummarySchema.parse({
    scope: 'local-recorded-chat-attempts',
    recordedFrom: first?.toISOString() ?? null,
    updatedAt: new Date().toISOString(),
    totals,
    profiles,
    recording: { currentProcessWriteFailures: writeFailures.toString() }
  });
}
