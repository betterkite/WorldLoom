import { z } from 'zod';

// Decimal strings avoid losing precision when PostgreSQL sums BIGINT values.
const count = z
  .string()
  .max(80)
  .regex(/^(0|[1-9][0-9]*)$/);
export const llmUsageCountersSchema = z.object({
  calls: count,
  knownUsageCalls: count,
  unknownUsageCalls: count,
  pendingCalls: count,
  failedCalls: count,
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  totalTokens: count.nullable()
});

export const llmUsageSummarySchema = z
  .object({
    scope: z.literal('local-recorded-chat-attempts'),
    recordedFrom: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
    totals: llmUsageCountersSchema,
    profiles: z.array(
      llmUsageCountersSchema.extend({ profileId: z.string().min(1), model: z.string().min(1) })
    ),
    recording: z.object({ currentProcessWriteFailures: count })
  })
  .superRefine((summary, context) => {
    const fields = [
      'calls',
      'knownUsageCalls',
      'unknownUsageCalls',
      'pendingCalls',
      'failedCalls',
      'inputTokens',
      'outputTokens',
      'totalTokens'
    ] as const;
    // Regex/length issues can be continuable in Zod; do not BigInt() bad strings.
    if (
      [summary.totals, ...summary.profiles].some((value) =>
        fields.some((field) => {
          const token = value[field];
          return token !== null && (token.length > 80 || !/^(0|[1-9][0-9]*)$/.test(token));
        })
      )
    )
      return;
    const validateCounters = (
      value: z.infer<typeof llmUsageCountersSchema>,
      path: (string | number)[]
    ) => {
      const known = BigInt(value.knownUsageCalls);
      const unknown = BigInt(value.unknownUsageCalls);
      const invalidCounts =
        known + unknown !== BigInt(value.calls) ||
        BigInt(value.pendingCalls) > unknown ||
        BigInt(value.failedCalls) + BigInt(value.pendingCalls) > BigInt(value.calls);
      const tokens = [value.inputTokens, value.outputTokens, value.totalTokens];
      const invalidTokens =
        known === BigInt(0)
          ? tokens.some((token) => token !== null)
          : tokens.some((token) => token === null) ||
            BigInt(value.inputTokens ?? '0') + BigInt(value.outputTokens ?? '0') !==
              BigInt(value.totalTokens ?? '0');
      if (invalidCounts || invalidTokens) {
        context.addIssue({ code: 'custom', message: 'Inconsistent usage counters', path });
      }
    };
    validateCounters(summary.totals, ['totals']);
    summary.profiles.forEach((profile, index) => validateCounters(profile, ['profiles', index]));
    for (const field of fields) {
      const sum = summary.profiles.reduce(
        (total, profile) => total + BigInt(profile[field] ?? '0'),
        BigInt(0)
      );
      if (sum !== BigInt(summary.totals[field] ?? '0')) {
        context.addIssue({
          code: 'custom',
          message: 'Usage total does not match profiles',
          path: ['totals', field]
        });
      }
    }
    if ((summary.recordedFrom === null) !== (summary.totals.calls === '0')) {
      context.addIssue({
        code: 'custom',
        message: 'Missing or unexpected recording start',
        path: ['recordedFrom']
      });
    }
  });

export type LlmUsageCounters = z.infer<typeof llmUsageCountersSchema>;
export type LlmUsageSummary = z.infer<typeof llmUsageSummarySchema>;

/** Formatting never converts cumulative counters to imprecise JS numbers. */
export function formatLlmUsageCount(value: string | null): string {
  return value === null ? '暂无完整用量' : BigInt(value).toLocaleString('zh-CN');
}
