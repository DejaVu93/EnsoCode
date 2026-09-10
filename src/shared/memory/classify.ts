import { DEFAULT_UNIT_TYPE, isUnitType, type UnitType } from './constants';

export type InputType = 'capture' | 'question' | 'url';
export type UnitTypeSource = 'explicit' | 'classifier' | 'fallback' | 'default';

export interface Classification {
  inputType: InputType | null;
  unitType: UnitType | null;
  title: string | null;
  cleanText: string;
  unitTypeSource: UnitTypeSource;
}

// 剥除用宽泛形式 `[TAG: 任意]`，所以非法值也会被剥掉。重复标签取最后一个匹配。
const TYPE_RE = /\[TYPE[:：]\s*(capture|question|url)\]/gi;
const UNIT_RE = /\[UNIT_TYPE[:：]\s*(\w+|null)\]/gi;
const TITLE_RE = /\[TITLE[:：]\s*([^\]]+)\]/gi;
const STRIP_RE = /\[(?:TYPE|UNIT_TYPE|TITLE)[:：][^\]]+\]/gi;
// 标签被模型错误地包进 fence 时，剥掉标签后只剩空 fence，一并清理。
const EMPTY_FENCE_RE = /```\w*\s*```/g;

function lastMatch(text: string, re: RegExp): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1];
  return last;
}

export function parseClassification(text: string): Classification {
  const inputType = (lastMatch(text, TYPE_RE)?.toLowerCase() as InputType | undefined) ?? null;
  const rawUnit = lastMatch(text, UNIT_RE)?.toLowerCase() ?? null;
  const rawTitle = lastMatch(text, TITLE_RE)?.trim() ?? null;

  let unitType: UnitType | null;
  let unitTypeSource: UnitTypeSource;
  if (rawUnit === null) {
    unitType = DEFAULT_UNIT_TYPE;
    unitTypeSource = 'default';
  } else if (rawUnit === 'null') {
    unitType = null;
    unitTypeSource = 'explicit';
  } else if (isUnitType(rawUnit)) {
    unitType = rawUnit;
    unitTypeSource = 'explicit';
  } else {
    unitType = DEFAULT_UNIT_TYPE;
    unitTypeSource = 'fallback';
  }

  const title =
    rawTitle === null || rawTitle === '' || rawTitle.toLowerCase() === 'null' ? null : rawTitle;

  const cleanText = text.replace(STRIP_RE, '').replace(EMPTY_FENCE_RE, '').trim();

  return { inputType, unitType, title, cleanText, unitTypeSource };
}
