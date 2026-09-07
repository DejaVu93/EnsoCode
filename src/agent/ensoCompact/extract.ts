import type { CompactBranchEntry, CompactFacts } from './types';

const PATH_RE = /(?:^|[\s`'"(])((?:src|app|lib|packages|test|tests)\/[\w./-]+\.\w+)/g;
const HARD_LINE_RE =
  /(?:^|\n)\s*(?:[-*]\s*)?(?:MUST|必须|不要|禁止|Do not|Don't|never|永远不要)\b[^\n]{2,200}/gi;
const GOAL_RE = /(?:Goal|目标)\s*[:：]\s*([^\n.]{3,160})/i;
const ERROR_RE = /\b(?:Error|TypeError|ReferenceError|FAILED|Exception)\b[:\s][^\n]{3,200}/i;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: string; text?: string };
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
    })
    .join('\n');
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key) continue;
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(key);
  }
  return out;
}

function pathsIn(text: string, args?: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of ['path', 'file', 'file_path', 'target']) {
    const value = args?.[key];
    if (typeof value === 'string' && /[./]/.test(value)) found.push(value);
  }
  PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null = PATH_RE.exec(text);
  while (match) {
    if (match[1]) found.push(match[1]);
    match = PATH_RE.exec(text);
  }
  return found;
}

function toolCalls(
  content: unknown
): Array<{ id?: string; name?: string; arguments?: Record<string, unknown> }> {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const rec = block as {
      type?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
    return rec.type === 'toolCall' ? [rec] : [];
  });
}

export function extractCompactFacts(entries: CompactBranchEntry[]): CompactFacts {
  const constraints: string[] = [];
  const errors: string[] = [];
  const files: string[] = [];
  const openLoops: string[] = [];
  let goal = '';
  let lastUser = '';

  for (const entry of entries) {
    const message = entry.message;
    if (!message) continue;
    const text = textOf(message.content);
    const role = message.role;
    if (role === 'user') {
      lastUser = text.trim();
      const goalMatch = GOAL_RE.exec(text);
      if (goalMatch?.[1]) goal = goalMatch[1].trim();
      HARD_LINE_RE.lastIndex = 0;
      let hard = HARD_LINE_RE.exec(text);
      while (hard) {
        constraints.push(hard[0].trim().replace(/^[-*]\s*/, ''));
        hard = HARD_LINE_RE.exec(text);
      }
      files.push(...pathsIn(text));
      if (/\b(?:still|blocked|TODO|未完成|卡住)\b/i.test(text)) {
        openLoops.push(text.slice(0, 160));
      }
    } else if (role === 'assistant') {
      const err = ERROR_RE.exec(text);
      if (err) errors.push(err[0].trim());
      for (const call of toolCalls(message.content)) {
        files.push(...pathsIn('', call.arguments));
      }
    }
  }

  if (!goal && lastUser && lastUser.length >= 24) goal = lastUser.slice(0, 160);
  return {
    goal,
    constraints: uniq(constraints).slice(0, 12),
    errors: uniq(errors).slice(0, 8),
    files: uniq(files).slice(0, 24),
    openLoops: uniq(openLoops).slice(0, 8),
  };
}
