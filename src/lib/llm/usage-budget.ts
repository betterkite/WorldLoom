import { getProfile, getProfileLimits, getProfilePricing } from './config';
import type { ChatRequest, ChatResult } from './client';

type ChatRunner<Request extends ChatRequest = ChatRequest> = (
  request: Request
) => Promise<ChatResult>;

type UsageLedger = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  exhaustedBy: LlmUsageBudgetError | null;
};

/** Safe error used when an operation exhausts its configured application budget. */
export class LlmUsageBudgetError extends Error {
  readonly code = 'llm_budget_exceeded';
  readonly operation: string;
  readonly profileId: string;

  constructor(operation: string, profileId: string, reason: string) {
    super(`LLM operation budget exceeded for ${operation} (${profileId}): ${reason}`);
    this.name = 'LlmUsageBudgetError';
    this.operation = operation;
    this.profileId = profileId;
  }
}

const budgetedRunners = new WeakSet<object>();

function hasConfiguredBudget(limits: ReturnType<typeof getProfileLimits>): boolean {
  return Boolean(
    limits &&
    (limits.maxInputTokensPerRun !== null ||
      limits.maxOutputTokensPerRun !== null ||
      limits.maxEstimatedCostUsdPerRun !== null)
  );
}

function isUsage(value: ChatResult['usage']): value is NonNullable<ChatResult['usage']> {
  return Boolean(
    value &&
    Number.isSafeInteger(value.inputTokens) &&
    value.inputTokens >= 0 &&
    Number.isSafeInteger(value.outputTokens) &&
    value.outputTokens >= 0
  );
}

/**
 * Add an operation-scoped, post-response usage guard to a chat runner.
 * Configured output limits also cap each subsequent request to the remaining
 * allowance. This is not an account-wide or provider billing hard limit.
 * Wrapping an already guarded runner is idempotent so nested services can
 * share one operation ledger (for example answer evaluation calling askWorld).
 */
export function withLlmUsageBudget<Request extends ChatRequest>(
  runner: ChatRunner<Request>,
  operation: string
): ChatRunner<Request> {
  if (budgetedRunners.has(runner)) return runner;

  const ledgers = new Map<string, UsageLedger>();
  const guarded: ChatRunner<Request> = async (request) => {
    const profile = getProfile(request.profileId);
    const limits = getProfileLimits(profile.id);
    if (!hasConfiguredBudget(limits)) return runner(request);
    if (!limits) return runner(request);

    let ledger = ledgers.get(profile.id);
    if (!ledger) {
      ledger = {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        exhaustedBy: null
      };
      ledgers.set(profile.id, ledger);
    }
    if (ledger.exhaustedBy) throw ledger.exhaustedBy;

    const pricing =
      limits.maxEstimatedCostUsdPerRun === null ? null : getProfilePricing(profile.id);
    const pricingMissing = limits.maxEstimatedCostUsdPerRun !== null && pricing === null;
    const violations: string[] = [];
    if (limits.maxInputTokensPerRun !== null && ledger.inputTokens >= limits.maxInputTokensPerRun) {
      violations.push(`input token budget ${limits.maxInputTokensPerRun} is exhausted`);
    }
    if (
      limits.maxOutputTokensPerRun !== null &&
      ledger.outputTokens >= limits.maxOutputTokensPerRun
    ) {
      violations.push(`output token budget ${limits.maxOutputTokensPerRun} is exhausted`);
    }
    if (
      limits.maxEstimatedCostUsdPerRun !== null &&
      ledger.estimatedCostUsd >= limits.maxEstimatedCostUsdPerRun
    ) {
      violations.push(`estimated-cost budget ${limits.maxEstimatedCostUsdPerRun} USD is exhausted`);
    }
    if (pricingMissing)
      violations.push('estimated-cost budget requires configured provider pricing');
    if (violations.length > 0) {
      ledger.exhaustedBy = new LlmUsageBudgetError(operation, profile.id, violations.join('; '));
      throw ledger.exhaustedBy;
    }

    let boundedRequest = request;
    if (limits.maxOutputTokensPerRun !== null) {
      const remaining = limits.maxOutputTokensPerRun - ledger.outputTokens;
      const maxTokens =
        request.maxTokens === undefined ? remaining : Math.min(request.maxTokens, remaining);
      if (maxTokens !== request.maxTokens) {
        boundedRequest = { ...request, maxTokens };
      }
    }

    const result = await runner(boundedRequest);
    if (result.profileId !== profile.id) {
      ledger.exhaustedBy = new LlmUsageBudgetError(
        operation,
        profile.id,
        'provider profile in the response did not match the budgeted profile'
      );
      throw ledger.exhaustedBy;
    }
    if (!isUsage(result.usage)) {
      ledger.exhaustedBy = new LlmUsageBudgetError(
        operation,
        profile.id,
        'provider token usage is missing or invalid; the configured budget cannot be verified'
      );
      throw ledger.exhaustedBy;
    }

    ledger.inputTokens += result.usage.inputTokens;
    ledger.outputTokens += result.usage.outputTokens;
    if (pricing) {
      ledger.estimatedCostUsd +=
        (result.usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
        (result.usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
    }

    const exceeded: string[] = [];
    if (limits.maxInputTokensPerRun !== null && ledger.inputTokens > limits.maxInputTokensPerRun) {
      exceeded.push(`input tokens ${ledger.inputTokens} > ${limits.maxInputTokensPerRun}`);
    }
    if (
      limits.maxOutputTokensPerRun !== null &&
      ledger.outputTokens > limits.maxOutputTokensPerRun
    ) {
      exceeded.push(`output tokens ${ledger.outputTokens} > ${limits.maxOutputTokensPerRun}`);
    }
    if (
      limits.maxEstimatedCostUsdPerRun !== null &&
      ledger.estimatedCostUsd > limits.maxEstimatedCostUsdPerRun
    ) {
      exceeded.push(
        `estimated cost ${ledger.estimatedCostUsd.toFixed(8)} > ${limits.maxEstimatedCostUsdPerRun} USD`
      );
    }
    if (exceeded.length > 0) {
      ledger.exhaustedBy = new LlmUsageBudgetError(operation, profile.id, exceeded.join('; '));
      throw ledger.exhaustedBy;
    }
    return result;
  };

  budgetedRunners.add(guarded);
  return guarded;
}
