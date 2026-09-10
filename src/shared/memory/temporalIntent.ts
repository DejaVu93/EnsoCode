// 时间意图只用正则门，不调 LLM。

export interface TemporalIntent {
  type: 'year' | 'relative';
  /** type=year 时的四位年份 */
  value: string | null;
  confidence: number;
}

// 年、季度/半年/财年、相对时间、中日文关键词
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const RELATIVE_RES = [
  // 光杆「Q1」也列为时间意图（不要求后跟年份）
  /\b(Q[1-4]|H[12])\b(?:\s*\d{2,4})?|\bFY\s*\d{2,4}\b|\bfiscal\s+year\b/i,
  /\b(before|after|since|until|between|during|within)\s+\w/i,
  /\b(last|next|this|past)\s+(week|month|year|quarter|decade|century)\b/i,
  /\b(recent|latest|current|upcoming)\s+(week|month|year|quarter|changes?|developments?|updates?)\b/i,
  /\byesterday\b|\btomorrow\b|\btoday\b/i,
  /(最近|去年|今年|明年|未来|过去|之前|之后|历史)/,
  // 日文只保留完整词：单字「前」「後」会命中「目前 / 前提 / 后续 / 前后端」等无时间含义的技术表述
  /(来年|過去|以前|以後|歴史|最近|昨日|明日)/,
];

// 正则门没有 LLM 的置信度输出；四位年份几乎不会误判取 1.0，相对词只表明「有时间意图」，
// relative 的匹配分为 0（pass），置信度缺省 0.5。
export function detectTemporalIntent(query: string): TemporalIntent | null {
  const year = YEAR_RE.exec(query);
  if (year) return { type: 'year', value: year[1], confidence: 1 };
  if (RELATIVE_RES.some((re) => re.test(query))) {
    return { type: 'relative', value: null, confidence: 0.5 };
  }
  return null;
}

const MS_PER_DAY = 86_400_000;

/**
 * 时间 boost：
 *   base  = 1 / (1 + |now - event_start|days / 365)        （事件越近越高）
 *   match = 0.8 当 type=year 且事件年份相等，否则 0
 *   boost = base * 0.3 + match * confidence * 0.7
 * 无 event_start 时为 0。
 */
export function computeTemporalBoost(
  eventStart: string | null,
  now: Date,
  intent: TemporalIntent
): number {
  if (!eventStart) return 0;
  const start = Date.parse(`${eventStart}T00:00:00.000Z`);
  if (Number.isNaN(start)) return 0;
  const diffDays = Math.abs(now.getTime() - start) / MS_PER_DAY;
  const base = 1 / (1 + diffDays / 365);
  const match = intent.type === 'year' && eventStart.slice(0, 4) === intent.value ? 0.8 : 0;
  return base * 0.3 + match * intent.confidence * 0.7;
}
