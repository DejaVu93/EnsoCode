import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type EvictedItem, selectKeptBoundary } from './budget';
import { BUDGETS, type CompactMode, chunkMessages, type MessageChunk } from './chunk';
import { extractCompactFacts } from './extract';
import {
  estimateTextTokens,
  normalizeMessages,
  pruneMessages,
  serializeMessages,
} from './serialize';
import {
  assembleFallback,
  assemblePrompt,
  chunkSummaryPrompt,
  compactSummaryPrompt,
  patchCompactSummary,
  textFromComplete,
} from './summarize';
import type {
  AgentMessage,
  CompactBranchEntry,
  CompactFacts,
  EnsoCompactOptions,
  FileOpsLike,
} from './types';
import { keepRecentTail } from './window';

const BASE_TIMEOUT_MS = 60_000;
const PER_CALL_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;
const CHUNK_CONCURRENCY = 3;
const MAX_TOKENS = { fast: 2048, auto: 4096, balanced: 4096, thorough: 6144 } as const;

type Complete = (prompt: string, maxTokens: number) => Promise<string>;

function asEntries(value: unknown): CompactBranchEntry[] {
  return Array.isArray(value) ? (value as CompactBranchEntry[]) : [];
}

/** 优先用 pi 算好的待压缩消息（空则无事可做）；旧版无此字段时才用 branch 去掉受保护尾巴。 */
function messagesToSummarize(
  prepared: unknown,
  branch: CompactBranchEntry[],
  mode: CompactMode
): AgentMessage[] {
  if (Array.isArray(prepared)) return normalizeMessages(prepared);
  const tail = keepRecentTail(branch, mode);
  const head = branch.slice(0, Math.max(0, branch.length - tail.length));
  return normalizeMessages(head.length ? head : branch);
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function chunkNote(chunk: MessageChunk, total: number): string {
  const facts = extractCompactFacts(chunk.messages);
  return `### CHUNK ${chunk.index + 1}/${total}: (model summary unavailable)
**Modified**: ${facts.modifiedFiles.join(', ') || 'None'}
**Read**: ${facts.readFiles.join(', ') || 'None'}
**Errors**: ${facts.errors.join(' | ') || 'None'}`;
}

async function summarizeHierarchical(
  chunks: MessageChunk[],
  facts: CompactFacts,
  previousSummary: string | undefined,
  complete: Complete,
  maxTokens: number
): Promise<string> {
  const parts = await mapConcurrent(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    try {
      const text = await complete(
        chunkSummaryPrompt(facts, serializeMessages(chunk.messages), chunk.index, chunks.length),
        Math.min(maxTokens, 1024)
      );
      return text || chunkNote(chunk, chunks.length);
    } catch {
      return chunkNote(chunk, chunks.length);
    }
  });
  try {
    const merged = await complete(assemblePrompt(facts, parts, previousSummary), maxTokens);
    return merged || assembleFallback(facts, parts, previousSummary);
  } catch {
    return assembleFallback(facts, parts, previousSummary);
  }
}

export function createEnsoCompactFactory(options: EnsoCompactOptions = {}) {
  const lastEstimatedAfter = new WeakMap<object, number>();
  return (pi: ExtensionAPI) => {
    pi.on('session_before_compact', async (event, ctx) => {
      const branch = asEntries(event.branchEntries ?? ctx.sessionManager.getBranch());
      if (branch.length < 3) return;

      const ref = options.summaryModel;
      const model = ref ? ctx.modelRegistry.find(ref.provider, ref.id) : ctx.model;
      if (!model) return;

      const preparation = event.preparation as typeof event.preparation & {
        previousSummary?: string;
        fileOps?: FileOpsLike;
      };
      const tokensBefore = preparation.tokensBefore;
      const firstKeptEntryId = preparation.firstKeptEntryId;
      if (!firstKeptEntryId || !(tokensBefore > 0)) return;

      const mode: CompactMode = options.mode ?? 'auto';
      const budget = BUDGETS[mode];
      const previousSummary = preparation.previousSummary;
      let keptId = firstKeptEntryId;
      let evicted: EvictedItem[] = [];
      const origin = branch.findIndex((entry) => entry.id === firstKeptEntryId);
      // 切点对不上 branch id 时不改（旧测试/无 id 会话），避免误 cancel
      if (origin >= 0) {
        const cut = selectKeptBoundary({
          branch,
          preparation: { firstKeptEntryId, previousSummary, tokensBefore },
          contextWindow: ctx.model?.contextWindow,
          previousEstimatedAfter: lastEstimatedAfter.get(ctx.sessionManager),
        });
        if ('fail' in cut) return { cancel: true };
        keptId = cut.firstKeptEntryId;
        evicted = cut.evicted;
        lastEstimatedAfter.set(ctx.sessionManager, cut.estimatedAfter);
      }
      const keptIndex = branch.findIndex((entry) => entry.id === keptId);
      const extra = origin >= 0 && keptIndex > origin ? branch.slice(origin, keptIndex) : [];
      let prepared: { facts: CompactFacts; transcript: string; chunks: MessageChunk[] };
      try {
        const pruned = pruneMessages([
          ...messagesToSummarize(preparation.messagesToSummarize, branch, mode),
          ...normalizeMessages(extra),
        ]);
        if (pruned.length === 0) return;
        const transcript = serializeMessages(pruned);
        const single = estimateTextTokens(transcript) < budget.singlePassMaxTokens;
        prepared = {
          facts: extractCompactFacts(pruned, preparation.fileOps),
          transcript,
          chunks: single ? [] : chunkMessages(pruned, budget.maxChunkTokens),
        };
      } catch {
        return;
      }
      const { facts, transcript, chunks } = prepared;
      const single = chunks.length === 0;
      const calls = single ? 1 : chunks.length + 1;

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        event.reason === 'manual'
          ? MAX_TIMEOUT_MS
          : Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + PER_CALL_TIMEOUT_MS * (calls - 1))
      );
      const signal = AbortSignal.any([event.signal, controller.signal]);
      const complete: Complete = async (prompt, maxTokens) =>
        textFromComplete(
          await ctx.modelRegistry.complete(
            model,
            {
              messages: [
                { role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() },
              ],
            },
            { signal, maxTokens }
          )
        );
      const maxTokens = MAX_TOKENS[mode];
      try {
        const drafted = single
          ? (await complete(compactSummaryPrompt(facts, transcript, previousSummary), maxTokens)) ||
            assembleFallback(facts, [], previousSummary)
          : await summarizeHierarchical(chunks, facts, previousSummary, complete, maxTokens);
        // 用户取消/超时后不要拿降级摘要当成功结果
        if (signal.aborted || !drafted) return;
        return {
          compaction: {
            summary: patchCompactSummary(drafted, facts, evicted),
            firstKeptEntryId: keptId,
            tokensBefore,
          },
        };
      } catch {
        return;
      } finally {
        clearTimeout(timer);
      }
    });
  };
}

export const ensoCompactInlineExtension = {
  name: 'enso-compact',
  hidden: true,
  factory: createEnsoCompactFactory(),
};
