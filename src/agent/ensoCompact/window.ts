import type { CompactBranchEntry } from './types';

const KEEP = { fast: 4, auto: 6, balanced: 8, thorough: 12 } as const;

function toolCallIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const rec = block as { type?: string; id?: string };
    return rec.type === 'toolCall' && rec.id ? [rec.id] : [];
  });
}

function resultId(message: CompactBranchEntry['message']): string | undefined {
  return message?.toolCallId ?? message?.tool_call_id;
}

export function keepRecentTail(
  entries: CompactBranchEntry[],
  mode: keyof typeof KEEP = 'balanced'
): CompactBranchEntry[] {
  const resultIds = new Set<string>();
  for (const entry of entries) {
    const id = resultId(entry.message);
    if (entry.message?.role === 'toolResult' && id) resultIds.add(id);
  }

  const eligible = entries.filter((entry) => {
    const calls = toolCallIds(entry.message?.content);
    if (calls.length === 0) return true;
    return calls.every((id) => resultIds.has(id));
  });

  const n = KEEP[mode] ?? KEEP.balanced;
  return eligible.slice(-n);
}
