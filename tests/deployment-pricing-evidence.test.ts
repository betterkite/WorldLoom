import { describe, expect, it } from 'vitest';
import {
  PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS,
  validateDatedPricingSource,
  validateProviderPricingEvidence
} from '../scripts/provider-pricing-evidence.mjs';

const CURRENT_DATE = new Date('2026-09-24T12:00:00.000Z');
const EVIDENCE = {
  sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
  checkedAt: '2026-09-23',
  modelVersion: 'DeepSeek-V4.1-Flash',
  billingBasis: 'peak input cache-miss and peak output rates'
};

describe('provider pricing evidence', () => {
  it('accepts a current, dated HTTPS source and model billing basis', () => {
    expect(validateProviderPricingEvidence(EVIDENCE, CURRENT_DATE)).toEqual({
      valid: true,
      reason: null,
      ageDays: 1
    });
  });

  it('expires a price snapshot after the configured review window', () => {
    const stale = {
      ...EVIDENCE,
      checkedAt: new Date(
        CURRENT_DATE.getTime() - (PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS + 1) * 86_400_000
      )
        .toISOString()
        .slice(0, 10)
    };
    expect(validateProviderPricingEvidence(stale, CURRENT_DATE)).toEqual({
      valid: false,
      reason: 'stale'
    });
  });

  it('rejects future or malformed verification dates and non-HTTPS sources', () => {
    expect(
      validateProviderPricingEvidence({ ...EVIDENCE, checkedAt: '2026-09-25' }, CURRENT_DATE)
    ).toMatchObject({ valid: false, reason: 'future' });
    expect(
      validateProviderPricingEvidence({ ...EVIDENCE, checkedAt: '2026-02-30' }, CURRENT_DATE)
    ).toMatchObject({ valid: false, reason: 'invalid' });
    expect(
      validateProviderPricingEvidence(
        { ...EVIDENCE, sourceUrl: 'http://api-docs.deepseek.com/pricing' },
        CURRENT_DATE
      )
    ).toMatchObject({ valid: false, reason: 'invalid' });
  });

  it('checks CNY source/date metadata without asserting model or account billing terms', () => {
    const source = { sourceUrl: EVIDENCE.sourceUrl, checkedAt: EVIDENCE.checkedAt };

    expect(validateDatedPricingSource(source, CURRENT_DATE)).toEqual({
      valid: true,
      reason: null,
      ageDays: 1
    });
    // Extracting the date helper must not weaken the existing USD evidence gate.
    expect(validateProviderPricingEvidence(source, CURRENT_DATE)).toEqual({
      valid: false,
      reason: 'invalid'
    });
  });

  it('keeps the source review window inclusive at exactly 90 days', () => {
    const source = {
      sourceUrl: EVIDENCE.sourceUrl,
      checkedAt: new Date(
        CURRENT_DATE.getTime() - PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS * 86_400_000
      )
        .toISOString()
        .slice(0, 10)
    };

    expect(validateDatedPricingSource(source, CURRENT_DATE)).toEqual({
      valid: true,
      reason: null,
      ageDays: PROVIDER_PRICING_EVIDENCE_MAX_AGE_DAYS
    });
  });

  it.each([null, [], {}])('rejects missing or malformed source-only metadata: %j', (source) => {
    expect(validateDatedPricingSource(source, CURRENT_DATE).valid).toBe(false);
  });
});
