import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import llmConfigFile from '../../../config/llm.json';

/**
 * Locked-profile LLM access configuration (WorldLoom).
 *
 * WorldLoom's model-access boundary:
 *  - Profiles are declared in version-controlled `config/llm.json`.
 *  - Provider / baseUrl / credential boundary is locked per profile id —
 *    callers may choose a profile but never an arbitrary base URL or key.
 *  - Credentials are only ever read from the env var named by
 *    `credentialEnv`; they are never persisted, logged or returned.
 */

const profileSchema = z.object({
  provider: z.literal('openai-compatible'),
  model: z.string().min(1),
  baseUrl: z
    .string()
    .url()
    .refine((url) => ['http:', 'https:'].includes(new URL(url).protocol), {
      message: 'baseUrl must be http(s)'
    }),
  credentialEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'credentialEnv must be an ENV var name'),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  maxRetries: z.number().int().min(0).max(3).default(1),
  pricing: z
    .object({
      inputUsdPerMillion: z.number().nonnegative(),
      outputUsdPerMillion: z.number().nonnegative()
    })
    .nullable()
    .optional(),
  limits: z
    .object({
      maxInputTokensPerRun: z.number().int().positive().nullable().default(null),
      maxOutputTokensPerRun: z.number().int().positive().nullable().default(null),
      maxEstimatedCostUsdPerRun: z.number().positive().nullable().default(null)
    })
    .nullable()
    .optional()
});

const embeddingsSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  credentialEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  dimensions: z.number().int().min(64).max(4096),
  batchSize: z.number().int().min(1).max(128).default(32)
});

const localEmbeddingsSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().min(1),
  dimensions: z.number().int().min(64).max(4096),
  dtype: z.enum(['fp32', 'fp16', 'int8', 'uint8', 'q8', 'q4']).default('q8'),
  cacheDir: z.string().min(1)
});

const configSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  defaultProfileId: z.string().min(1),
  profiles: z.record(z.string(), profileSchema),
  embeddings: embeddingsSchema.optional(),
  localEmbeddings: localEmbeddingsSchema.optional()
});

export type LlmProfile = z.infer<typeof profileSchema> & { id: string };

export class LlmConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LlmConfigError';
    this.code = code;
  }
}

let cached: Record<string, LlmProfile> | null = null;
let cachedDefaultId: string | null = null;
let cachedEmbeddings: z.infer<typeof embeddingsSchema> | null = null;
let cachedLocalEmbeddings: z.infer<typeof localEmbeddingsSchema> | null = null;

function parseConfig(): {
  profiles: Record<string, LlmProfile>;
  defaultProfileId: string;
  embeddings: z.infer<typeof embeddingsSchema> | null;
  localEmbeddings: z.infer<typeof localEmbeddingsSchema> | null;
} {
  if (cached && cachedDefaultId)
    return {
      profiles: cached,
      defaultProfileId: cachedDefaultId,
      embeddings: cachedEmbeddings,
      localEmbeddings: cachedLocalEmbeddings
    };
  const parsed = configSchema.safeParse(llmConfigFile);
  if (!parsed.success) {
    throw new LlmConfigError(
      'llm_config_invalid',
      `config/llm.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  cached = Object.fromEntries(
    Object.entries(parsed.data.profiles).map(([id, profile]) => [id, { ...profile, id }])
  );
  cachedDefaultId = parsed.data.defaultProfileId;
  cachedEmbeddings = parsed.data.embeddings ?? null;
  cachedLocalEmbeddings = parsed.data.localEmbeddings ?? null;
  if (!cached[cachedDefaultId]) {
    throw new LlmConfigError(
      'llm_config_invalid',
      `defaultProfileId "${cachedDefaultId}" has no matching profile in config/llm.json`
    );
  }
  return {
    profiles: cached,
    defaultProfileId: cachedDefaultId,
    embeddings: cachedEmbeddings,
    localEmbeddings: cachedLocalEmbeddings
  };
}

/** Resolve a profile by id (falls back to the default). Throws on unknown id. */
export function getProfile(profileId?: string | null): LlmProfile {
  const { profiles, defaultProfileId } = parseConfig();
  const id = profileId?.trim() || defaultProfileId;
  const profile = profiles[id];
  if (!profile) {
    throw new LlmConfigError('llm_profile_unknown', `LLM profile is not declared: ${id}`);
  }
  return profile;
}

export function getDefaultProfileId(): string {
  return parseConfig().defaultProfileId;
}

export type LlmPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type LlmLimits = {
  maxInputTokensPerRun: number | null;
  maxOutputTokensPerRun: number | null;
  maxEstimatedCostUsdPerRun: number | null;
};

/** Pricing is deliberately optional; never infer or hard-code provider rates. */
export function getProfilePricing(profileId?: string | null): LlmPricing | null {
  return getProfile(profileId).pricing ?? null;
}

/** Optional per-run guardrails; null means the operator has not configured a cap. */
export function getProfileLimits(profileId?: string | null): LlmLimits | null {
  return getProfile(profileId).limits ?? null;
}

export function listProfileIds(): string[] {
  return Object.keys(parseConfig().profiles);
}

/**
 * Read the credential for a profile from its locked env var.
 * Returns the key (or null when unset) — callers must never log or persist it.
 */
export function getCredential(profile: LlmProfile): string | null {
  const value = process.env[profile.credentialEnv]?.trim();
  return value ? value : null;
}

/** Whether a profile has its credential configured (never leaks the value). */
export function isCredentialConfigured(profile: LlmProfile): boolean {
  return getCredential(profile) !== null;
}

/** Optional semantic-embedding endpoint config (Phase 4); null when absent. */
export function getEmbeddingsConfig(): z.infer<typeof embeddingsSchema> | null {
  parseConfig();
  return cachedEmbeddings;
}

/** Optional on-device semantic embedding config; model files live outside git. */
export function getLocalEmbeddingsConfig(): z.infer<typeof localEmbeddingsSchema> | null {
  parseConfig();
  return cachedLocalEmbeddings;
}

/** Whether the configured local model directory is actually available on this host. */
export function isLocalEmbeddingAvailable(): boolean {
  const config = getLocalEmbeddingsConfig();
  if (!config?.enabled) return false;
  const modelDir = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    config.cacheDir,
    config.model
  );
  return (
    existsSync(modelDir) &&
    existsSync(resolve(modelDir, 'config.json')) &&
    existsSync(resolve(modelDir, 'tokenizer.json'))
  );
}

/** Whether semantic retrieval can run through the remote or local provider chain. */
export function isSemanticEnabled(): boolean {
  const cfg = getEmbeddingsConfig();
  const remoteEnabled = Boolean(cfg?.enabled && process.env[cfg.credentialEnv]?.trim());
  return remoteEnabled || isLocalEmbeddingAvailable();
}
