export type TemporalPrecision = 'year' | 'month' | 'day';

const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 日期只存 YYYY-MM-DD，精度单独返回。边界：
// 年 1000–9999、月 1–12、日需为真实日期；非法时返回 [null, null] 由调用方决定。
export function normalizeTemporalDate(
  s: string | null | undefined
): [string, TemporalPrecision] | [null, null] {
  const m = DATE_RE.exec((s ?? '').trim());
  if (!m) return [null, null];
  const year = Number(m[1]);
  const month = m[2] === undefined ? 1 : Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    return [null, null];
  }
  const precision: TemporalPrecision =
    m[3] !== undefined ? 'day' : m[2] !== undefined ? 'month' : 'year';
  return [`${m[1]}-${pad(month)}-${pad(day)}`, precision];
}

// year/month/day 分别展开为全年/整月/当天闭区间。
export function expandTemporalRange(date: string, precision: TemporalPrecision): [string, string] {
  const [y, m] = date.split('-').map(Number);
  if (precision === 'year') return [date, `${y}-12-31`];
  if (precision === 'month') return [date, `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`];
  return [date, date];
}

// YYYY-MM-DD 字典序即时间序，闭区间相交判断。
export function rangesIntersect(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
