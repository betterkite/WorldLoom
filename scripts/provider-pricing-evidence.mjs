const DAY_MS = 24 * 60 * 60 * 1_000;
export const PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS = 90;

/** Validate the dated, human-verified price source used by deployment preflight. */
export function validateProviderPricingEvidence(evidence, now = new Date()) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { valid: false, reason: 'missing' };
  }

  const { sourceUrl, checkedAt, modelVersion, billingBasis } = evidence;
  if (
    typeof sourceUrl !== 'string' ||
    typeof checkedAt !== 'string' ||
    typeof modelVersion !== 'string' ||
    !modelVersion.trim() ||
    typeof billingBasis !== 'string' ||
    !billingBasis.trim()
  ) {
    return { valid: false, reason: 'invalid' };
  }

  try {
    if (new URL(sourceUrl).protocol !== 'https:') return { valid: false, reason: 'invalid' };
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
    return { valid: false, reason: 'invalid' };
  }
  const checked = new Date(`${checkedAt}T00:00:00.000Z`);
  if (!Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 10) !== checkedAt) {
    return { valid: false, reason: 'invalid' };
  }

  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return { valid: false, reason: 'invalid' };
  const currentDay = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  );
  const ageDays = Math.floor((currentDay - checked.getTime()) / DAY_MS);
  if (ageDays < 0) return { valid: false, reason: 'future' };
  if (ageDays > PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS) {
    return { valid: false, reason: 'stale' };
  }
  return { valid: true, reason: null, ageDays };
}
