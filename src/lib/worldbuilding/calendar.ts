/**
 * C-2 自定义历法：世界可定义月名与天数、闰法。
 * calendarJson = { "months": [{"name":"初月","days":30}, ...], "yearLabel": "年", "leapRule": {"everyYears": 4, "addDays": 1} }
 */

export interface WorldCalendar {
  months: { name: string; days: number }[];
  yearLabel: string;
  leapRule?: { everyYears: number; addDays: number };
}

export function parseCalendar(calendarJson: string | null | undefined): WorldCalendar | null {
  try {
    const parsed = JSON.parse(calendarJson || '{}') as Partial<WorldCalendar>;
    if (!Array.isArray(parsed.months) || parsed.months.length === 0) return null;
    return {
      months: parsed.months.map((month) => ({
        name: String(month.name),
        days: Number(month.days)
      })),
      yearLabel: String(parsed.yearLabel ?? '年'),
      leapRule: parsed.leapRule
    };
  } catch {
    return null;
  }
}

/** 渲染虚构日期：有历法用月名，无历法则回落到纪元年；精度不足时省略低阶字段。 */
export function formatFictionDate(
  input: { year: number | null; month: number | null; day: number | null },
  calendar: WorldCalendar | null
): string {
  if (input.year === null) return '未纪年';
  const parts = [`${input.year} ${calendar?.yearLabel ?? '年'}`];
  if (input.month !== null) {
    const monthName = calendar?.months[input.month - 1]?.name;
    parts.push(monthName ? `${monthName}` : `${input.month} 月`);
  }
  if (input.day !== null) parts.push(`${input.day} 日`);
  return parts.join(' ');
}

export function daysInMonth(calendar: WorldCalendar | null, month: number): number | null {
  if (!calendar) return null;
  return calendar.months[month - 1]?.days ?? null;
}

export function daysInYear(calendar: WorldCalendar | null, year: number): number | null {
  if (!calendar) return null;
  const base = calendar.months.reduce((sum, month) => sum + month.days, 0);
  const leap =
    calendar.leapRule &&
    calendar.leapRule.everyYears > 0 &&
    year % calendar.leapRule.everyYears === 0;
  return base + (leap ? (calendar.leapRule?.addDays ?? 0) : 0);
}
