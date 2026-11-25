import { describe, expect, it } from 'vitest';
import { createChronology, type DatedEvent } from '@/lib/worldbuilding/chronology';

const epochs = [
  { uid: 'epo_a', order: 0 },
  { uid: 'epo_b', order: 1 },
  { uid: 'epo_max', order: 10_000 }
];
const date = (uid: string, values: Partial<DatedEvent> = {}): DatedEvent => ({
  uid,
  epochUid: 'epo_a',
  epochYear: 3,
  epochMonth: 1,
  epochDay: 2,
  fictionPrecision: 'day',
  ...values
});

describe('fiction date ranges and display positions', () => {
  it('orders full dates rather than insertion order, including custom months and days', () => {
    const a = date('evt_a');
    const b = date('evt_b', { epochDay: 3 });
    const c = date('evt_c', { epochMonth: 2, epochDay: 1 });
    const d = date('evt_d', { epochMonth: 99, epochDay: 999 });
    const chronology = createChronology([d, b, c, a], epochs);
    expect(chronology.events.map((event) => event.uid)).toEqual([
      'evt_a',
      'evt_b',
      'evt_c',
      'evt_d'
    ]);
    expect(chronology.atAnchor(c, a)).toBe('future');
    expect(chronology.atAnchor(a, c)).toBe('included');
  });

  it('separates epochs across the entire accepted year/order domain without large stored numbers', () => {
    const a = date('evt_a', { epochYear: 100_000 });
    const b = date('evt_b', { epochUid: 'epo_b', epochYear: -100_000 });
    const c = date('evt_c', { epochUid: 'epo_max', epochYear: 100_000 });
    const chronology = createChronology([c, b, a], epochs);
    expect(chronology.events.map((event) => event.uid)).toEqual(['evt_a', 'evt_b', 'evt_c']);
    expect(chronology.events.map((event) => event.chronologyPosition)).toEqual([1, 2, 3]);
    expect(chronology.before(a, b)).toBe(true);
  });

  it('does not use stable UID presentation order to invent same-day causality', () => {
    const a = date('evt_z');
    const b = date('evt_a');
    const chronology = createChronology([a, b], epochs);
    expect(chronology.events.map((event) => event.uid)).toEqual(['evt_a', 'evt_z']);
    expect(chronology.events.map((event) => event.chronologyPosition)).toEqual([1, 1]);
    expect(chronology.before(a, b)).toBe(false);
    expect(chronology.before(b, a)).toBe(false);
    expect(chronology.atAnchor(a, b)).toBe('included');
    expect(chronology.latest()).toHaveLength(2);
  });

  it.each([
    { fictionPrecision: 'year', epochMonth: null, epochDay: null },
    { fictionPrecision: 'month', epochMonth: 1, epochDay: null },
    { fictionPrecision: 'day', epochMonth: 1, epochDay: null },
    { fictionPrecision: 'day', epochMonth: null, epochDay: 2 },
    { fictionPrecision: 'year', epochMonth: 99, epochDay: 999 }
  ])('preserves overlapping/partial date uncertainty: %j', (values) => {
    const partial = date('evt_partial', values);
    const exact = date('evt_exact');
    const chronology = createChronology([partial, exact], epochs);
    expect(chronology.before(partial, exact)).toBe(false);
    expect(chronology.before(exact, partial)).toBe(false);
    expect(chronology.atAnchor(partial, exact)).toBe('uncertain');
  });

  it('keeps missing epochs/years unknown and still includes the anchor itself', () => {
    const unknown = date('evt_unknown', { epochUid: 'epo_missing' });
    const missingYear = date('evt_year', { epochYear: null });
    const exact = date('evt_exact');
    const chronology = createChronology([unknown, missingYear, exact], epochs);
    expect(chronology.atAnchor(unknown, exact)).toBe('uncertain');
    expect(chronology.atAnchor(missingYear, exact)).toBe('uncertain');
    expect(chronology.atAnchor(unknown, unknown)).toBe('included');
  });

  it('does not assert order between different epochs sharing the same ordinal', () => {
    const a = date('evt_a', { epochYear: -100 });
    const b = date('evt_b', { epochUid: 'epo_b', epochYear: 100 });
    const chronology = createChronology(
      [a, b],
      [
        { uid: 'epo_a', order: 0 },
        { uid: 'epo_b', order: 0 }
      ]
    );
    expect(chronology.before(a, b)).toBe(false);
    expect(chronology.atAnchor(a, b)).toBe('uncertain');
  });
});
