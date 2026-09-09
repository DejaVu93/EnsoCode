import { parseAgentUri } from '../structuredYield';
import { formatHashlineHeader, formatNumberedLines } from './format';
import { HASHLINE_READ_GUIDELINES, withGuidelines } from './prompts';
import type { InMemorySnapshotStore } from './snapshots';

interface ContentPart {
  type?: string;
  text?: string;
}

function snapshotText(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') return undefined;
    const item = part as ContentPart;
    if (item.type === 'image') return undefined;
    if (item.type !== 'text' || typeof item.text !== 'string') return undefined;
    texts.push(item.text);
  }
  return texts.join('');
}

/** pi read 尾部的续读提示（截断 / limit 未读完） */
const READ_NOTICE = /\n\n(\[(?:Showing lines|\d+ more lines)[^\n]*\])$/;

function splitNotice(body: string): { text: string; notice: string } {
  const match = READ_NOTICE.exec(body);
  return match
    ? { text: body.slice(0, match.index), notice: match[0] }
    : { text: body, notice: '' };
}

export function withHashlineRead<T extends { execute: (...args: never[]) => unknown }>(
  definition: T,
  store: InMemorySnapshotStore,
  options: { readFileText?: (path: string) => Promise<string | undefined> } = {}
): T {
  const execute = definition.execute as (
    toolCallId: string,
    params: unknown,
    ...rest: unknown[]
  ) => unknown;
  return withGuidelines(
    {
      ...definition,
      execute: (async (toolCallId: string, params: unknown, ...rest: unknown[]) => {
        const result = await execute(toolCallId, params, ...rest);
        const filePath = String((params as { path?: string } | undefined)?.path ?? '');
        if (!filePath || parseAgentUri(filePath)) return result;
        if (!result || typeof result !== 'object') return result;
        const body = snapshotText((result as { content?: unknown }).content);
        if (body === undefined) return result;
        const offset = Number((params as { offset?: unknown } | undefined)?.offset ?? 1);
        const startLine = Number.isFinite(offset) && offset > 1 ? offset : 1;
        const { text, notice } = splitNotice(body);
        // 局部读取：tag 必须对应整文件，否则后续 hashline edit 永远 stale
        const partial = startLine > 1 || notice !== '';
        const snapshot = partial ? await options.readFileText?.(filePath) : text;
        if (snapshot === undefined) return result;
        const tag = store.record(filePath, snapshot);
        return {
          ...(result as object),
          content: [
            {
              type: 'text',
              text: `${formatHashlineHeader(filePath, tag)}\n${formatNumberedLines(text, startLine)}${notice}`,
            },
          ],
        };
      }) as T['execute'],
    },
    HASHLINE_READ_GUIDELINES
  );
}
