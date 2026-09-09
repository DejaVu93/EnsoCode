export type EditArgKind =
  | { kind: 'replace' }
  | { kind: 'hashline' }
  | { kind: 'mixed' }
  | { kind: 'invalid' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasHashlineInput(value: Record<string, unknown>): boolean {
  return typeof value.input === 'string' && value.input.length > 0;
}

function hasReplaceFields(value: Record<string, unknown>): boolean {
  if ('edits' in value) return Array.isArray(value.edits);
  return typeof value.oldText === 'string' && typeof value.newText === 'string';
}

function isBlankText(value: unknown): boolean {
  return value === undefined || value === '';
}

function isBlankEditItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;
  return isBlankText(rec.oldText) && isBlankText(rec.newText);
}

/** 模型顺手填的占位：空数组、全空 edits 项、或空 oldText+newText */
function hasEmptyReplaceFields(value: Record<string, unknown>): boolean {
  if ('edits' in value) return Array.isArray(value.edits) && value.edits.every(isBlankEditItem);
  return value.oldText === '' && value.newText === '';
}

function looksLikeBrokenReplace(value: Record<string, unknown>): boolean {
  if ('edits' in value && !Array.isArray(value.edits)) return true;
  const hasOld = typeof value.oldText === 'string';
  const hasNew = typeof value.newText === 'string';
  return hasOld !== hasNew;
}

export function classifyEditArgs(input: unknown): EditArgKind {
  if (!isRecord(input)) return { kind: 'invalid' };
  const hashline = hasHashlineInput(input);
  const replace = hasReplaceFields(input);
  // 混发：两边都有实质内容则拒绝；空壳 replace 字段视为占位走 hashline
  if (hashline && replace) {
    return hasEmptyReplaceFields(input) ? { kind: 'hashline' } : { kind: 'mixed' };
  }
  if (hashline) return { kind: 'hashline' };
  if (replace) return { kind: 'replace' };
  if (looksLikeBrokenReplace(input) || typeof input.input === 'string') return { kind: 'invalid' };
  return { kind: 'invalid' };
}
