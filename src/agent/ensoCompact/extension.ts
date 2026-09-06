import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { extractCompactFacts } from './extract';
import { compactSummaryPrompt, patchCompactSummary, textFromComplete } from './summarize';
import type { CompactBranchEntry, EnsoCompactOptions } from './types';
import { keepRecentTail } from './window';

const AUTO_TIMEOUT_MS = 60_000;

function asEntries(value: unknown): CompactBranchEntry[] {
  return Array.isArray(value) ? (value as CompactBranchEntry[]) : [];
}

function prefixText(entries: CompactBranchEntry[]): string {
  return entries
    .map((entry) => {
      const role = entry.message?.role ?? '';
      const content = entry.message?.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((block) =>
                  typeof block === 'string'
                    ? block
                    : block && typeof block === 'object' && 'text' in block
                      ? String((block as { text?: string }).text ?? '')
                      : ''
                )
                .join('')
            : '';
      return `${role}: ${text}`.trim();
    })
    .filter(Boolean)
    .join('\n');
}

export function createEnsoCompactFactory(options: EnsoCompactOptions = {}) {
  return (pi: ExtensionAPI) => {
    pi.on('session_before_compact', async (event, ctx) => {
      const branch = asEntries(event.branchEntries ?? ctx.sessionManager.getBranch());
      const facts = extractCompactFacts(branch);
      if (branch.length < 3) return;

      const ref = options.summaryModel;
      const model = ref ? ctx.modelRegistry.find(ref.provider, ref.id) : ctx.model;
      if (!model) return;

      const mode = options.mode ?? 'auto';
      const tail = keepRecentTail(branch, mode);
      const toSummarize = asEntries(
        event.preparation.messagesToSummarize ??
          branch.slice(0, Math.max(0, branch.length - tail.length))
      );
      const prompt = compactSummaryPrompt(facts, prefixText(toSummarize));
      const tokensBefore = event.preparation.tokensBefore;
      const firstKeptEntryId = event.preparation.firstKeptEntryId;
      if (!firstKeptEntryId || !(tokensBefore > 0)) return;

      const controller = new AbortController();
      const timer =
        event.reason === 'manual'
          ? undefined
          : setTimeout(() => controller.abort(), AUTO_TIMEOUT_MS);
      const signal = AbortSignal.any([event.signal, controller.signal]);
      try {
        const response = await ctx.modelRegistry.complete(
          model,
          {
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: prompt }],
                timestamp: Date.now(),
              },
            ],
          },
          {
            signal,
            maxTokens: mode === 'fast' ? 2048 : mode === 'thorough' ? 6144 : 4096,
          }
        );
        const drafted = textFromComplete(response);
        if (!drafted) return;
        return {
          compaction: {
            summary: patchCompactSummary(drafted, facts),
            firstKeptEntryId,
            tokensBefore,
          },
        };
      } catch {
        return;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  };
}

export const ensoCompactInlineExtension = {
  name: 'enso-compact',
  hidden: true,
  factory: createEnsoCompactFactory(),
};
