import {
  FREQUENCY_MAX_COUNT,
  FREQUENCY_W,
  HALF_LIFE_DAYS,
  IMP_MULT,
  MIN_FLOOR,
  RECENCY_W,
} from './constants';

const MS_PER_DAY = 86_400_000;

export interface DecayInput {
  lastAccessedAt: Date | string | null | undefined;
  accessCount: number;
  importance: number;
  now: Date;
}

// 公式：
//   recency   = exp(-days/HALF_LIFE_DAYS) —— 是 exp 不是 0.5^x，实际半衰期 30·ln2 ≈ 20.8 天；
//               「半衰期 30」的自然语言与代码不一致，以代码为准，勿「修正」回去
//   frequency = log(1+min(n,100))/log(100)
//   decay     = 0.7*recency + 0.3*frequency，floor = 0.3 + 0.2*importance
// days 与 timedelta.days 一致取整数天；未来时间视为 0 天；上限 1 为本项目补充（n≥100 时公式会略超 1）。
export function computeDecayScore({
  lastAccessedAt,
  accessCount,
  importance,
  now,
}: DecayInput): number {
  let recency = 0;
  if (lastAccessedAt) {
    const last = lastAccessedAt instanceof Date ? lastAccessedAt : new Date(lastAccessedAt);
    if (!Number.isNaN(last.getTime())) {
      const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY));
      recency = Math.exp(-days / HALF_LIFE_DAYS);
    }
  }

  const n = Math.min(Math.max(0, accessCount), FREQUENCY_MAX_COUNT);
  const frequency = Math.log(1 + n) / Math.log(FREQUENCY_MAX_COUNT);

  const floor = MIN_FLOOR + IMP_MULT * importance;
  const score = RECENCY_W * recency + FREQUENCY_W * frequency;
  return Math.min(1, Math.max(floor, score));
}
