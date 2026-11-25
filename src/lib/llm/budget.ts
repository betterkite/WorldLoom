import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LlmProfile } from './config';
import type { ChatRequest, ChatResult } from './client';

export class LlmBudgetError extends Error {
  constructor() {
    super('累计模型预算不足或预算账本不可用；已停止新的付费请求');
    this.name = 'LlmBudgetError';
  }
}

const entrySchema = z.object({
  id: z.string(),
  profileId: z.string(),
  model: z.string(),
  state: z.enum(['reserved', 'settled', 'unknown']),
  heldMicroCny: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable()
});
const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  limitMicroCny: z.number().int().positive(),
  entries: z.array(entrySchema)
});
type Ledger = z.infer<typeof ledgerSchema>;

/** Ledger writes are synchronous, exclusive and atomic; contention fails closed.
 * Use one shared local-volume path for all processes in the budgeted test.
 * No prompts, completions, credentials or provider error bodies enter the file.
 */
function updateLedger(filename: string, limitMicroCny: number, update: (ledger: Ledger) => void) {
  const lock = `${filename}.lock`;
  let fd: number | undefined;
  let temporary: string | undefined;
  let cleanupFailed = false;
  try {
    fd = openSync(lock, 'wx', 0o600);
    const ledger = existsSync(filename)
      ? ledgerSchema.parse(JSON.parse(readFileSync(filename, 'utf8')))
      : { schemaVersion: 1 as const, limitMicroCny, entries: [] };
    if (ledger.limitMicroCny !== limitMicroCny) throw new LlmBudgetError();
    update(ledger);
    temporary = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filename);
    temporary = undefined;
  } catch {
    throw new LlmBudgetError();
  } finally {
    if (temporary) {
      try {
        unlinkSync(temporary);
      } catch {
        /* Preserve the safe error above. */
      }
    }
    if (fd !== undefined) {
      try {
        closeSync(fd);
        unlinkSync(lock);
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) throw new LlmBudgetError();
}

/** Optional aggregate CNY guard. Reserve before EVERY upstream attempt, including
 * retries. Unknown usage retains the reservation, even across process restarts.
 * Input reservation uses UTF-8 payload bytes plus 65,536 tokens of template
 * headroom; this is a conservative estimate, not the provider's billing invoice.
 */
export function reserveLlmCall(
  profile: LlmProfile,
  request: ChatRequest,
  env: Record<string, string | undefined> = process.env
) {
  const raw = env.WORLDLOOM_LLM_BUDGET_CNY;
  const filename = env.WORLDLOOM_LLM_BUDGET_LEDGER;
  if (raw === undefined && filename === undefined) return null;
  const limitMicroCny = Math.floor(Number(raw) * 1_000_000);
  const pricing = profile.pricingCny;
  const maxOutputTokens = request.maxTokens;
  if (
    !filename ||
    !isAbsolute(filename) ||
    !Number.isSafeInteger(limitMicroCny) ||
    limitMicroCny <= 0 ||
    !pricing ||
    !maxOutputTokens ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  )
    throw new LlmBudgetError();
  const cost = (input: number, output: number) =>
    Math.ceil(input * pricing.inputPerMillion + output * pricing.outputPerMillion);
  const maxInputTokens = Buffer.byteLength(JSON.stringify(request.messages), 'utf8') + 65_536;
  const heldMicroCny = cost(maxInputTokens, maxOutputTokens);
  const id = randomUUID();
  updateLedger(filename, limitMicroCny, (ledger) => {
    if (ledger.entries.some((entry) => entry.state === 'unknown')) throw new LlmBudgetError();
    const used = ledger.entries.reduce((sum, entry) => sum + entry.heldMicroCny, 0);
    if (!Number.isSafeInteger(heldMicroCny) || used + heldMicroCny > limitMicroCny)
      throw new LlmBudgetError();
    ledger.entries.push({
      id,
      profileId: profile.id,
      model: profile.model,
      state: 'reserved',
      heldMicroCny,
      maxInputTokens,
      maxOutputTokens,
      inputTokens: null,
      outputTokens: null
    });
  });
  return {
    settle(usage: ChatResult['usage']) {
      updateLedger(filename, limitMicroCny, (ledger) => {
        const entry = ledger.entries.find((item) => item.id === id);
        if (!entry || entry.state !== 'reserved') throw new LlmBudgetError();
        if (
          !usage ||
          !Number.isSafeInteger(usage.inputTokens) ||
          usage.inputTokens < 0 ||
          !Number.isSafeInteger(usage.outputTokens) ||
          usage.outputTokens < 0 ||
          usage.inputTokens > maxInputTokens ||
          usage.outputTokens > maxOutputTokens
        ) {
          entry.state = 'unknown';
          return;
        }
        entry.state = 'settled';
        entry.inputTokens = usage.inputTokens;
        entry.outputTokens = usage.outputTokens;
        entry.heldMicroCny = cost(usage.inputTokens, usage.outputTokens);
      });
    },
    unknown() {
      updateLedger(filename, limitMicroCny, (ledger) => {
        const entry = ledger.entries.find((item) => item.id === id);
        if (entry?.state === 'reserved') entry.state = 'unknown';
      });
    }
  };
}
