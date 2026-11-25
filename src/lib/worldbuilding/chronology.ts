/** Fiction dates are ranges, not wall-clock dates. Never consult today's calendar
 * when interpreting an immutable version. Display ranks are not causal evidence. */
export interface DatedEvent {
  uid: string;
  epochUid: string | null;
  epochYear: number | null;
  epochMonth?: number | null;
  epochDay?: number | null;
  fictionPrecision: string;
}

export interface OrderedEpoch {
  uid: string;
  order: number;
}

type Point = readonly [number, number, number, number];
interface DateRange {
  epochUid: string;
  lower: Point;
  upper: Point;
}

export const CHRONOLOGY_FORMAT = 'date-rank-v1';

function comparable(a: DateRange, b: DateRange): boolean {
  return a.epochUid === b.epochUid || a.lower[0] !== b.lower[0];
}

function comparePoint(a: Point, b: Point): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function dateRange(event: DatedEvent, epochs: ReadonlyMap<string, OrderedEpoch>): DateRange | null {
  const epoch = event.epochUid ? epochs.get(event.epochUid) : null;
  if (!epoch) return null;
  const year = event.epochYear;
  const month = event.fictionPrecision !== 'year' ? event.epochMonth : null;
  const day = event.fictionPrecision === 'day' && month != null ? event.epochDay : null;
  // A missing larger component prevents a smaller component establishing order.
  return {
    epochUid: epoch.uid,
    lower: [
      epoch.order,
      year ?? -Infinity,
      year != null ? (month ?? -Infinity) : -Infinity,
      year != null && month != null ? (day ?? -Infinity) : -Infinity
    ],
    upper: [
      epoch.order,
      year ?? Infinity,
      year != null ? (month ?? Infinity) : Infinity,
      year != null && month != null ? (day ?? Infinity) : Infinity
    ]
  };
}

export function createChronology<T extends DatedEvent>(
  events: readonly T[],
  epochs: readonly OrderedEpoch[]
) {
  const epochMap = new Map(epochs.map((epoch) => [epoch.uid, epoch]));
  const ranges = new Map(events.map((event) => [event.uid, dateRange(event, epochMap)]));

  function before(a: DatedEvent, b: DatedEvent): boolean {
    const left = ranges.get(a.uid);
    const right = ranges.get(b.uid);
    return (
      !!left && !!right && comparable(left, right) && comparePoint(left.upper, right.lower) < 0
    );
  }

  function sameInstant(a: DatedEvent, b: DatedEvent): boolean {
    const left = ranges.get(a.uid);
    const right = ranges.get(b.uid);
    return (
      !!left &&
      !!right &&
      left.epochUid === right.epochUid &&
      comparePoint(left.lower, left.upper) === 0 &&
      comparePoint(right.lower, right.upper) === 0 &&
      comparePoint(left.lower, right.lower) === 0
    );
  }

  function atAnchor(event: DatedEvent, anchor: DatedEvent): 'included' | 'future' | 'uncertain' {
    if (event.uid === anchor.uid || before(event, anchor) || sameInstant(event, anchor))
      return 'included';
    return before(anchor, event) ? 'future' : 'uncertain';
  }

  function compareDate(a: DatedEvent, b: DatedEvent): number {
    const left = ranges.get(a.uid);
    const right = ranges.get(b.uid);
    if (!left || !right) return left ? 1 : right ? -1 : 0;
    return (
      comparePoint(left.lower, right.lower) ||
      comparePoint(left.upper, right.upper) ||
      left.epochUid.localeCompare(right.epochUid)
    );
  }

  const ordered = events.toSorted((a, b) => compareDate(a, b) || a.uid.localeCompare(b.uid));
  if (ordered.length > 2_147_483_647)
    throw new Error('Chronology exceeds the supported event count');
  let position = 0;
  const projected = ordered.map((event, index) => {
    if (index === 0 || compareDate(ordered[index - 1], event) !== 0) position += 1;
    return { ...event, chronologyPosition: position };
  });
  const latestLowerByEpoch = new Map<string, Point>();
  let lastEpochOrder = -Infinity;
  for (const range of ranges.values()) {
    if (!range) continue;
    lastEpochOrder = Math.max(lastEpochOrder, range.lower[0]);
    const latestLower = latestLowerByEpoch.get(range.epochUid);
    if (!latestLower || comparePoint(range.lower, latestLower) > 0) {
      latestLowerByEpoch.set(range.epochUid, range.lower);
    }
  }
  return {
    events: projected,
    byUid: new Map(projected.map((event) => [event.uid, event])),
    before,
    sameInstant,
    atAnchor,
    // A deterministic last row alone cannot prove that no unordered event is later.
    latest: () =>
      projected.filter((event) => {
        const range = ranges.get(event.uid);
        if (!range) return true;
        if (range.lower[0] < lastEpochOrder) return false;
        return comparePoint(range.upper, latestLowerByEpoch.get(range.epochUid)!) >= 0;
      })
  };
}
