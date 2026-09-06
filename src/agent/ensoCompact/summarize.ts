import type { CompactFacts } from './types';

function hasSection(summary: string, title: string): boolean {
  return new RegExp(`^#{1,3}\\s+${title}\\b`, 'im').test(summary);
}

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function patchCompactSummary(summary: string, facts: CompactFacts): string {
  const parts: string[] = [summary.trim()].filter(Boolean);
  if (facts.goal && !hasSection(summary, 'Goal') && !summary.includes(facts.goal)) {
    parts.push(`## Goal\n${facts.goal}`);
  }
  if (facts.constraints.length > 0 && !hasSection(summary, 'Constraints')) {
    const missing = facts.constraints.filter((c) => !summary.includes(c));
    if (missing.length) parts.push(`## Constraints\n${list(missing)}`);
  }
  if (facts.errors.length > 0 && !hasSection(summary, 'Errors')) {
    const missing = facts.errors.filter((e) => !summary.includes(e));
    if (missing.length) parts.push(`## Errors\n${list(missing)}`);
  }
  if (facts.openLoops.length > 0 && !hasSection(summary, 'Open loops')) {
    const missing = facts.openLoops.filter((l) => !summary.includes(l));
    if (missing.length) parts.push(`## Open loops\n${list(missing)}`);
  }
  if (facts.files.length > 0 && !hasSection(summary, 'Files')) {
    const missing = facts.files.filter((f) => !summary.includes(f));
    if (missing.length) parts.push(`## Files\n${list(missing)}`);
  }
  return parts.join('\n\n').trim();
}

export function compactSummaryPrompt(facts: CompactFacts, prefix: string): string {
  return `Summarize this coding session as markdown with sections Goal, Constraints, Progress, Open loops, Errors, Files. Do not invent facts. Use the extracted facts when present.

Facts:
${JSON.stringify(facts, null, 2)}

Prefix:
${prefix.slice(0, 24_000)}`;
}

export function textFromComplete(response: { content?: unknown }): string {
  const content = response.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: string; text?: string };
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
    })
    .join('\n')
    .trim();
}
