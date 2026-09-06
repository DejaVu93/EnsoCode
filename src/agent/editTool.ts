import {
  createEditToolDefinition,
  type EditToolOptions,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

function isSingleEdit(value: unknown): value is { oldText: string; newText: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.oldText === 'string' && typeof edit.newText === 'string';
}

function looksLikeJsonContainer(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"');
}

/** 数字键对象（{"0": edit}）当数组；JSON 工具调用里常见 */
function arrayLikeValues(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0 || keys.some((key) => !/^\d+$/.test(key))) return undefined;
  return keys
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (value as Record<string, unknown>)[key]);
}

/** 递归 unwrap 看起来像 JSON 的字符串；截断或非法则原样返回 */
function unwrapJson(value: unknown, depth = 0): unknown {
  if (typeof value !== 'string' || depth > 3) return value;
  if (!looksLikeJsonContainer(value)) return value;
  try {
    return unwrapJson(JSON.parse(value), depth + 1);
  } catch {
    return value;
  }
}

function flattenEditItems(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    const unwrapped = unwrapJson(item);
    if (isSingleEdit(unwrapped)) {
      out.push(unwrapped);
      continue;
    }
    const nested = Array.isArray(unwrapped) ? unwrapped : arrayLikeValues(unwrapped);
    if (nested) {
      out.push(...flattenEditItems(nested));
      continue;
    }
    out.push(unwrapped);
  }
  return out;
}

function rejectUnparsedEditsJson(edits: unknown): void {
  const leftover =
    typeof edits === 'string'
      ? [edits]
      : Array.isArray(edits)
        ? edits.filter((item): item is string => typeof item === 'string')
        : [];
  if (leftover.some(looksLikeJsonContainer)) {
    throw new Error(
      'edits must be an array of {oldText, newText} objects. ' +
        'Do not encode the array as a JSON string — a truncated or invalid string is treated as characters and fails as edits.0: must be object.'
    );
  }
}

function normalizeEditsValue(edits: unknown): unknown {
  const unwrapped = unwrapJson(edits);
  if (isSingleEdit(unwrapped)) return [unwrapped];
  const asArray = Array.isArray(unwrapped) ? unwrapped : arrayLikeValues(unwrapped);
  return asArray ? flattenEditItems(asArray) : unwrapped;
}

/** schema 校验前把模型常见的畸形 edits 还原成对象数组；截断 JSON 字符串抛明确错误 */
export function normalizeEditArguments(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const args = { ...(input as Record<string, unknown>) };
  if (!('edits' in args)) return args;
  const next = normalizeEditsValue(args.edits);
  rejectUnparsedEditsJson(next);
  return next === args.edits ? args : { ...args, edits: next };
}

/** 叠在 stock pi edit 上，不放宽 schema */
export function createNormalizedEditTool(cwd: string, options?: EditToolOptions): ToolDefinition {
  const base = createEditToolDefinition(cwd, options) as unknown as ToolDefinition;
  const prepareBase = base.prepareArguments;
  return {
    ...base,
    prepareArguments: ((args: unknown) => {
      const normalized = normalizeEditArguments(args);
      return prepareBase ? prepareBase(normalized) : normalized;
    }) as ToolDefinition['prepareArguments'],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const prepared = prepareBase
        ? prepareBase(normalizeEditArguments(params))
        : normalizeEditArguments(params);
      return base.execute(toolCallId, prepared as typeof params, signal, onUpdate, ctx);
    },
  };
}
