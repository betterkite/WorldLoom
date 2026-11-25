import { isIP } from 'node:net';
import { resolve as resolvePosix } from 'node:path/posix';

// These are operator declarations linked to real evidence, never evidence themselves.
export const LOCAL_DEPLOYMENT_FACTS = [
  ['WORLDLOOM_LOCAL_NETWORK_CONFIRMED', 'runtime loopback-only access and no external forwarding'],
  ['WORLDLOOM_LOCAL_INSTALL_CONFIRMED', 'clean installation, migration and runtime readiness'],
  ['WORLDLOOM_LOCAL_USAGE_CONFIRMED', 'persistent cumulative usage, retries and unknown usage'],
  ['WORLDLOOM_BACKUP_RESTORE_CONFIRMED', 'local backup and verified data restoration'],
  ['WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED', 'schema compatibility and application rollback'],
  ['WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED', 'local app/worker roles, recovery and process concurrency'],
  ['WORLDLOOM_LOCAL_RESOURCE_BASELINE_CONFIRMED', 'representative local resource baseline, not stress load'],
  ['WORLDLOOM_SUPPLY_CHAIN_CONFIRMED', 'exact-source distribution licenses and artifact provenance'],
  ['WORLDLOOM_OBSERVABILITY_CONFIRMED', 'local task/errors/usage observation and recovery instructions'],
  ['WORLDLOOM_PRIVACY_CONFIRMED', 'secrets, user materials and data lifecycle review']
];

const BUDGET_ENV = [
  'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN',
  'WORLDLOOM_LLM_BUDGET_CNY',
  'WORLDLOOM_LLM_BUDGET_LEDGER'
];
const LIMIT_FIELDS = [
  'maxInputTokensPerRun', 'maxOutputTokensPerRun', 'maxEstimatedCostUsdPerRun'
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && Boolean(value.trim());

export function isLiteralLoopback(host) {
  if (typeof host !== 'string') return false;
  if (host === '::1' || host === '[::1]') return true;
  return isIP(host) === 4 && host.split('.')[0] === '127';
}

function origin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) ||
        !(url.hostname === 'localhost' || isLiteralLoopback(url.hostname)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function localDatabaseUrl(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      (url.hostname === 'db' || url.hostname === 'localhost' || isLiteralLoopback(url.hostname)) &&
      url.pathname.length > 1;
  } catch {
    return false;
  }
}

/** Pure offline validation. Never execute Compose, open a DB or query a provider. */
export function evaluateLocalDeployment({ compose, config, facts = {}, localFilesPresent = false,
  expectedCacheSource }) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const check = (id, valid, message) => add(id, valid ? 'PASS' : 'FAIL', message);
  const services = object(compose?.services) ? compose.services : {};
  const required = ['db', 'app', 'worker', 'migrate'];
  check('compose.services', required.every((name) => object(services[name])),
    'Resolved Compose must declare db, app, worker and migrate services');

  const serviceEntries = Object.values(services);
  const portsSafe = serviceEntries.every((service) => object(service) &&
    (service.network_mode === undefined || service.network_mode === 'none') &&
    (service.ports === undefined || (Array.isArray(service.ports) && service.ports.every((port) =>
      object(port) && typeof port.host_ip === 'string' && isLiteralLoopback(port.host_ip) &&
      /^[0-9]+$/.test(String(port.published)) && Number(port.published) >= 1 &&
      Number(port.published) <= 65535))));
  check('compose.loopback', portsSafe && serviceEntries.length > 0,
    'Every published port needs an explicit literal loopback host_ip; shared/host networking is refused');
  check('compose.private-worker', ['worker', 'migrate'].every((name) =>
    object(services[name]) && (services[name].ports === undefined ||
      (Array.isArray(services[name].ports) && services[name].ports.length === 0))),
    'Worker and migration services must not publish host ports');

  const appEnv = object(services.app?.environment) ? services.app.environment : {};
  const workerEnv = object(services.worker?.environment) ? services.worker.environment : {};
  const migrateEnv = object(services.migrate?.environment) ? services.migrate.environment : {};
  check('runtime.environments', [services.app, services.worker, services.migrate].every((service) =>
    object(service?.environment)), 'Runtime environments must be resolved JSON objects, not dotenv templates');
  check('runtime.roles', appEnv.WORLDLOOM_WORKER === 'false' && workerEnv.WORLDLOOM_WORKER === 'true',
    'App role must be false and independent worker role true');
  check('runtime.node-env', [appEnv, workerEnv].every((env) =>
    env.NODE_ENV === undefined || env.NODE_ENV === 'production'),
    'Explicit NODE_ENV must be production; an omitted value still requires runtime image verification');
  check('runtime.database', localDatabaseUrl(appEnv.DATABASE_URL) &&
    appEnv.DATABASE_URL === workerEnv.DATABASE_URL && appEnv.DATABASE_URL === migrateEnv.DATABASE_URL,
    'App, worker and migration must declare the same local PostgreSQL connection (values withheld)');
  check('runtime.concurrency', [appEnv, workerEnv].every((env) => {
    const value = env.WORLDLOOM_WORKER_MAX_CONCURRENCY;
    return typeof value === 'string' && /^[0-9]+$/.test(value) &&
      Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 32;
  }), 'Both app and worker need explicit in-process concurrency between 1 and 32');

  const appOrigin = origin(appEnv.NEXT_PUBLIC_APP_URL);
  const port = appOrigin?.port || (appOrigin?.protocol === 'https:' ? '443' : '80');
  check('runtime.origin', appOrigin !== null && Array.isArray(services.app?.ports) &&
    services.app.ports.some((binding) => object(binding) && String(binding.published) === port &&
      (binding.protocol === undefined || binding.protocol === 'tcp') &&
      (appOrigin.hostname === 'localhost' || binding.host_ip === appOrigin.hostname.replace(/^\[|\]$/g, ''))),
    'App origin must be a credential-free loopback HTTP(S) origin matching a declared app port');
  check('runtime.worker-origin', workerEnv.NEXT_PUBLIC_APP_URL === appEnv.NEXT_PUBLIC_APP_URL,
    'Worker and app must declare the same canonical app origin');
  check('runtime.tls-mode', [appEnv, workerEnv].every((env) =>
    env.WORLDLOOM_TLS_TERMINATED === undefined || env.WORLDLOOM_TLS_TERMINATED === 'false'),
    'Direct local mode must not claim trusted external TLS termination');

  const profiles = object(config?.profiles) ? config.profiles : {};
  check('llm.schema-version', config?.schemaVersion === 1 || config?.schemaVersion === 2,
    'LLM configuration schemaVersion must be supported');
  const profile = typeof config?.defaultProfileId === 'string' &&
    Object.hasOwn(profiles, config.defaultProfileId) ? profiles[config.defaultProfileId] : null;
  check('llm.default-profile', object(profile) && profile.provider === 'openai-compatible' &&
    nonEmpty(profile.model) && /^[A-Z][A-Z0-9_]*$/.test(profile.credentialEnv ?? ''),
    'Default profile must have a declared model, provider and credential variable name');
  let providerSafe = false;
  try {
    const url = new URL(profile?.baseUrl);
    providerSafe = !url.username && !url.password && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && (url.hostname === 'localhost' || isLiteralLoopback(url.hostname))));
  } catch { /* Static, value-free failure below. */ }
  check('llm.endpoint', providerSafe, 'Default provider endpoint must use HTTPS or literal local HTTP');
  const timeout = profile?.timeoutMs === undefined ? 60_000 : profile.timeoutMs;
  const retries = profile?.maxRetries === undefined ? 1 : profile.maxRetries;
  check('llm.resource-bounds', object(profile) &&
    Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 300_000 &&
    Number.isInteger(retries) && retries >= 0 && retries <= 3,
    'Model deadlines and bounded retries remain resource protections, not consumption quotas');
  check('llm.credentials', object(profile) && /^[A-Z][A-Z0-9_]*$/.test(profile.credentialEnv ?? '') &&
    [appEnv, workerEnv].every((env) => nonEmpty(env[profile.credentialEnv])),
    'Default LLM credential must be non-empty in both declared runtime environments (values withheld)');
  check('llm.uncapped-profiles', Object.keys(profiles).length > 0 && Object.values(profiles).every((item) =>
    object(item) && (item.limits == null || (object(item.limits) &&
      LIMIT_FIELDS.every((field) => item.limits[field] == null)))),
    'Local personal mode requires no configured consumption caps in selectable profiles');
  check('llm.uncapped-runtime', [appEnv, workerEnv].every((env) =>
    BUDGET_ENV.every((name) => !Object.hasOwn(env, name))),
    'Local personal mode requires budget variables to be absent, not empty or invalid');

  const local = config?.localEmbeddings;
  const cacheDirValid = typeof local?.cacheDir === 'string' && local.cacheDir !== '' &&
    !local.cacheDir.startsWith('/') && !local.cacheDir.split(/[\\/]/).includes('..');
  const target = cacheDirValid ? resolvePosix('/app', local.cacheDir) : null;
  check('embedding.local-enabled', local?.enabled === true && cacheDirValid,
    'The local embedding fallback must be enabled with a project-relative cache directory');
  check('embedding.files', localFilesPresent === true,
    'Configured local embedding tokenizer/config/model files must be non-empty; this is not inference proof');
  check('embedding.mounts', target !== null && target !== '/app' && typeof expectedCacheSource === 'string' &&
    ['app', 'worker'].every((name) => Array.isArray(services[name]?.volumes) &&
      services[name].volumes.some((mount) => object(mount) && mount.type === 'bind' &&
        mount.target === target && mount.source === expectedCacheSource && mount.read_only === true)),
    'App and worker must declare the same checked local cache as read-only bind mounts');
  check('embedding.dimensions', Number.isInteger(local?.dimensions) && local.dimensions >= 64 &&
    local.dimensions <= 4096 && (config?.embeddings?.enabled !== true ||
      local.dimensions === config.embeddings.dimensions),
    'Enabled remote and fallback embedding dimensions must agree');

  for (const [name, label] of LOCAL_DEPLOYMENT_FACTS) {
    check(`fact.${name}`, object(facts) && facts[name] === 'true',
      `${label}: evidence-linked operator declaration required (${name})`);
  }
  add('scope.external-gateway', 'N/A', 'No external users: public gateway authentication and gateway rate limiting');
  add('scope.public-tls', 'N/A', 'No public exposure: public TLS certificates and proxy HSTS');
  add('scope.account-cap', 'N/A', 'Human chose uncapped personal use; account/operation consumption quotas are not a local release requirement');
  add('scope.cross-host', 'N/A', 'Single local host: cross-host HA and production-scale benchmarks; local recovery/resources remain required');
  add('evidence.limit', 'WARN', 'Offline declarations only: no runtime, model, migration, readiness, restore, license or human-quality verification performed');
  return {
    schemaVersion: 'worldloom.local-preflight/v1', scope: 'local-single-user-uncapped-compose',
    passed: !checks.some((item) => item.status === 'FAIL'), releaseApproved: false, checks
  };
}
