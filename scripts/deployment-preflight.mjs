#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || process.env.WORLDLOOM_PREFLIGHT_STRICT === 'true';
const requireSemantic =
  args.has('--require-semantic') || process.env.WORLDLOOM_PREFLIGHT_REQUIRE_SEMANTIC === 'true';
const errors = [];
const warnings = [];
const passes = [];

function pass(message) {
  passes.push(message);
}

function warn(message) {
  warnings.push(message);
}

function fail(message) {
  errors.push(message);
}

function checkCredential(envName, label, { required = strict } = {}) {
  const configured = Boolean(process.env[envName]?.trim());
  if (configured) {
    pass(`${label}: credential configured (${envName})`);
  } else if (required) {
    fail(`${label}: credential is missing (${envName})`);
  } else {
    warn(`${label}: credential is not configured (${envName})`);
  }
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function checkProfileBudget(profileId, profile) {
  const pricing = profile.pricing;
  const limits = profile.limits;
  const pricingValid =
    pricing &&
    isFiniteNonNegative(pricing.inputUsdPerMillion) &&
    isFiniteNonNegative(pricing.outputUsdPerMillion);
  const limitsValid =
    limits &&
    Number.isInteger(limits.maxInputTokensPerRun) &&
    limits.maxInputTokensPerRun > 0 &&
    Number.isInteger(limits.maxOutputTokensPerRun) &&
    limits.maxOutputTokensPerRun > 0 &&
    typeof limits.maxEstimatedCostUsdPerRun === 'number' &&
    Number.isFinite(limits.maxEstimatedCostUsdPerRun) &&
    limits.maxEstimatedCostUsdPerRun > 0;

  if (pricingValid) pass(`${profileId}: provider pricing table is configured`);
  else if (strict) fail(`${profileId}: provider pricing table is missing or invalid`);
  else warn(`${profileId}: provider pricing table is not configured`);

  if (limitsValid && limits.maxEstimatedCostUsdPerRun !== null) {
    pass(`${profileId}: token and estimated-cost limits are configured`);
  } else if (strict) {
    fail(`${profileId}: token and estimated-cost limits are missing or invalid`);
  } else {
    warn(`${profileId}: token and estimated-cost limits are not fully configured`);
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(resolve('config/llm.json'), 'utf8'));
  } catch (error) {
    fail(`config/llm.json cannot be read: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    return null;
  }
}

const config = loadConfig();
if (config) {
  if (!config.defaultProfileId || typeof config.defaultProfileId !== 'string') {
    fail('config/llm.json: defaultProfileId is missing');
  }
  if (!config.profiles || typeof config.profiles !== 'object') {
    fail('config/llm.json: profiles is missing');
  } else {
    const defaultProfile = config.profiles[config.defaultProfileId];
    if (!defaultProfile) {
      fail(`config/llm.json: default profile ${config.defaultProfileId} is missing`);
    } else {
      const { credentialEnv, baseUrl } = defaultProfile;
      if (!/^[A-Z][A-Z0-9_]*$/.test(credentialEnv ?? '')) {
        fail(`${config.defaultProfileId}: credentialEnv is invalid`);
      } else {
        checkCredential(credentialEnv, config.defaultProfileId);
      }
      try {
        const parsedUrl = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('unsupported protocol');
        pass(`${config.defaultProfileId}: provider endpoint uses ${parsedUrl.protocol.slice(0, -1)}`);
      } catch {
        fail(`${config.defaultProfileId}: provider endpoint is not a valid HTTP(S) URL`);
      }
      checkProfileBudget(config.defaultProfileId, defaultProfile);
    }
  }

  const embeddings = config.embeddings;
  const localEmbeddings = config.localEmbeddings;
  const localModelPath = localEmbeddings?.enabled
    ? resolve(process.cwd(), localEmbeddings.cacheDir, localEmbeddings.model)
    : null;
  const localReady = Boolean(localModelPath && existsSync(localModelPath));

  if (localEmbeddings?.enabled) {
    if (localReady) pass(`local embeddings/${localEmbeddings.model}: model cache is present`);
    else warn(`local embeddings/${localEmbeddings.model}: model cache is missing`);
  }

  if (embeddings?.enabled) {
    const label = `embeddings/${embeddings.model}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(embeddings.credentialEnv ?? '')) {
      fail(`${label}: credentialEnv is invalid`);
    } else {
      checkCredential(embeddings.credentialEnv, label, {
        required: requireSemantic && !localReady
      });
    }
  } else if (requireSemantic && !localReady) {
    fail('semantic acceptance was requested but embeddings are disabled');
  } else if (!localReady) {
    warn('embeddings are disabled; runtime will use lexical retrieval');
  } else {
    pass('semantic retrieval: local embedding fallback is available');
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
if (/^postgres(?:ql)?:\/\//.test(databaseUrl)) pass('DATABASE_URL: PostgreSQL connection is configured');
else if (strict) fail('DATABASE_URL: PostgreSQL connection is missing or invalid');
else warn('DATABASE_URL: PostgreSQL connection is not visible in the process environment');

if (strict && process.env.NODE_ENV !== 'production') {
  fail('NODE_ENV must be production in strict deployment mode');
} else if (process.env.NODE_ENV === 'production') {
  pass('NODE_ENV: production');
} else {
  warn('NODE_ENV is not production; use --strict for the production gate');
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? '';
if (strict) {
  try {
    const parsedUrl = new URL(appUrl);
    if (parsedUrl.protocol !== 'https:') throw new Error('HTTPS required');
    pass('NEXT_PUBLIC_APP_URL: HTTPS origin is configured');
  } catch {
    fail('NEXT_PUBLIC_APP_URL must be an HTTPS origin in strict deployment mode');
  }
} else if (appUrl) {
  pass('NEXT_PUBLIC_APP_URL: origin is configured');
} else {
  warn('NEXT_PUBLIC_APP_URL is not configured');
}

if (process.env.WORLDLOOM_TLS_TERMINATED === 'true') {
  pass('WORLDLOOM_TLS_TERMINATED=true: HSTS may be enabled behind the trusted proxy');
} else if (strict) {
  fail('WORLDLOOM_TLS_TERMINATED must be true in strict deployment mode');
} else {
  warn('WORLDLOOM_TLS_TERMINATED is not true; HSTS remains disabled');
}

const workerValue = process.env.WORLDLOOM_WORKER;
if (workerValue === 'true' || workerValue === 'false') {
  pass(`WORLDLOOM_WORKER=${workerValue}: runtime role is explicit`);
} else if (strict) {
  fail('WORLDLOOM_WORKER must be explicitly true or false in strict deployment mode');
} else {
  warn('WORLDLOOM_WORKER is not explicit; set it to true or false for deployment');
}

const workerConcurrency = Number.parseInt(process.env.WORLDLOOM_WORKER_MAX_CONCURRENCY ?? '', 10);
if (Number.isInteger(workerConcurrency) && workerConcurrency >= 1 && workerConcurrency <= 32) {
  pass(`WORLDLOOM_WORKER_MAX_CONCURRENCY=${workerConcurrency}: in-process task cap is explicit`);
} else if (strict) {
  fail('WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32 in strict deployment mode');
} else {
  warn('WORLDLOOM_WORKER_MAX_CONCURRENCY is not explicit; default 4 applies locally');
}

const deploymentFacts = [
  ['WORLDLOOM_GATEWAY_AUTH_CONFIRMED', 'gateway authentication'],
  ['WORLDLOOM_RATE_LIMIT_CONFIRMED', 'gateway rate limiting'],
  ['WORLDLOOM_BACKUP_RESTORE_CONFIRMED', 'production backup/restore drill'],
  ['WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED', 'production migration rollback drill'],
  ['WORLDLOOM_TARGET_SCALE_CONFIRMED', 'target-scale concurrency benchmark'],
  ['WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED', 'worker topology and capacity']
];
for (const [envName, label] of deploymentFacts) {
  if (process.env[envName] === 'true') pass(`${label}: deployment fact confirmed (${envName})`);
  else if (strict) fail(`${label}: deployment fact is not confirmed (${envName}=true required)`);
  else warn(`${label}: deployment fact is not confirmed; set ${envName}=true after verification`);
}

console.log(`WorldLoom deployment preflight (${strict ? 'strict' : 'local'})`);
for (const message of passes) console.log(`PASS  ${message}`);
for (const message of warnings) console.log(`WARN  ${message}`);
for (const message of errors) console.log(`FAIL  ${message}`);
console.log(`\n==== ${passes.length} pass · ${warnings.length} warning · ${errors.length} failure ====`);

if (errors.length) {
  console.error('Deployment preflight failed. Resolve the listed deployment facts before release.');
  process.exitCode = 1;
} else {
  console.log('Deployment preflight passed for the selected mode.');
}
