import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SmartCompactMode } from '@shared/smartCompactMode';
import type { SpawnModelConfig } from '@shared/types/agent';
import smartCompactExtension from 'pi-smart-compact';

export const ENSO_SMART_COMPACT_CONFIG = {
  requireApproval: false,
  contextGraphEnabled: false,
  agentToolAccess: 'disabled',
  autoTrigger: true,
  autoTriggerStrategy: 'native-hook',
  showStatus: false,
  mode: 'auto' as SmartCompactMode,
  /** /compact 也走 session_before_compact；默认 60% 会让手动压缩直接让出原生 */
  minContextPercent: 0,
} as const;

export interface SmartCompactRoute {
  summaryModel: string | null;
  mode?: SmartCompactMode;
}

/** provider 注册 id：掺 api/baseUrl/apiKey 指纹。不含斜杠，扩展才能按 provider/id 解析。 */
export function providerKeyFor(model: { api: string; baseUrl: string; apiKey: string }): string {
  const keyFp = createHash('sha256').update(model.apiKey).digest('hex').slice(0, 8);
  const host = createHash('sha256')
    .update(`${model.api}\0${model.baseUrl}`)
    .digest('hex')
    .slice(0, 12);
  return `enso-${host}-${keyFp}`;
}

export function formatSmartCompactSummaryModel(model: SpawnModelConfig): string {
  const provider = model.oauthAccountKey ?? providerKeyFor(model);
  return `${provider}/${model.modelId}`;
}

type CompactHookEvent = {
  type?: string;
  reason?: string;
  preparation?: { tokensBefore?: number };
};

type CompactUsage = {
  tokens?: number | null;
  contextWindow?: number;
  percent?: number | null;
};

type CompactHookCtx = {
  getContextUsage?: () => CompactUsage | undefined;
  model?: { contextWindow?: number };
  sessionManager?: {
    getBranch?: () => unknown[];
    buildContextEntries?: () => unknown[];
  };
};

/**
 * 扩展把 host.tokens − 本地消息估算当成压不动的固定开销。
 * Cursor/Grok 的 cache+system 常把差额撑到整窗 50%+，窗口规划立刻让出。
 * 门槛仍用 billed/host；规划窗口改用消息估算，和扩展本地估同一量纲。
 */
export function estimateSmartCompactMessageTokens(entries: unknown[] | undefined): number | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let chars = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    try {
      chars += JSON.stringify(entry).length;
    } catch {
      /* skip cyclic */
    }
  }
  if (chars <= 0) return null;
  return Math.max(1, Math.ceil(chars / 4));
}

export function usageForSmartCompactPlanning(input: {
  reason?: string;
  billedTokens?: number | null;
  messageTokens?: number | null;
  contextWindow?: number;
}): CompactUsage {
  const billed =
    typeof input.billedTokens === 'number' && input.billedTokens > 0 ? input.billedTokens : null;
  const message =
    typeof input.messageTokens === 'number' && input.messageTokens > 0 ? input.messageTokens : null;
  const contextWindow =
    typeof input.contextWindow === 'number' && input.contextWindow > 0
      ? input.contextWindow
      : undefined;
  let tokens = billed ?? message;
  if (input.reason === 'manual' && message !== null && contextWindow !== undefined) {
    const billedOrMessage = billed ?? message;
    const maxFixed = Math.floor(contextWindow * 0.25);
    tokens = message + Math.min(Math.max(0, billedOrMessage - message), maxFixed);
  }
  const percentSource = billed ?? tokens;
  const percent =
    typeof percentSource === 'number' && contextWindow !== undefined
      ? (percentSource / contextWindow) * 100
      : undefined;
  return { tokens: tokens ?? undefined, contextWindow, percent };
}

/** Pi 的 getContextUsage() 常因 contextWindow/usage 边界返回 tokens=null；扩展却用它做门槛和窗口。 */
export function wrapSmartCompactFactory(
  factory: (pi: ExtensionAPI) => void | Promise<void>
): (pi: ExtensionAPI) => void | Promise<void> {
  return (pi) => {
    const rawOn = pi.on.bind(pi) as (event: string, handler: (...args: never[]) => unknown) => void;
    const wrapped = {
      ...pi,
      on(event: string, handler: (...args: never[]) => unknown) {
        if (event !== 'session_before_compact') return rawOn(event, handler);
        return rawOn(event, ((evt: CompactHookEvent, ctx: CompactHookCtx, ...rest: never[]) => {
          const tokensBefore = evt?.preparation?.tokensBefore;
          const patched = {
            ...ctx,
            getContextUsage: () => {
              const usage = ctx.getContextUsage?.();
              const billed =
                typeof usage?.tokens === 'number' && usage.tokens > 0
                  ? usage.tokens
                  : typeof tokensBefore === 'number' && tokensBefore > 0
                    ? tokensBefore
                    : null;
              const entries =
                ctx.sessionManager?.buildContextEntries?.() ?? ctx.sessionManager?.getBranch?.();
              return usageForSmartCompactPlanning({
                reason: evt?.reason,
                billedTokens: billed,
                messageTokens: estimateSmartCompactMessageTokens(entries),
                contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
              });
            },
          };
          return handler(evt as never, patched as never, ...rest);
        }) as (...args: never[]) => unknown);
      },
    } as ExtensionAPI;
    return factory(wrapped);
  };
}

/** 与 explore-fold / pi-cursor 一样：静态 import 后塞进 extensionFactories，不走磁盘路径。 */
export const smartCompactInlineExtension = {
  name: 'pi-smart-compact',
  hidden: true,
  factory: wrapSmartCompactFactory(smartCompactExtension),
};

export function mergeSmartCompactSettings(
  existing: unknown,
  route?: SmartCompactRoute
): Record<string, unknown> {
  const root =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const section =
    root.smartCompact && typeof root.smartCompact === 'object' && !Array.isArray(root.smartCompact)
      ? { ...(root.smartCompact as Record<string, unknown>) }
      : {};
  const smartCompact: Record<string, unknown> = { ...section, ...ENSO_SMART_COMPACT_CONFIG };
  if (route) {
    if (route.summaryModel) smartCompact.summaryModel = route.summaryModel;
    else delete smartCompact.summaryModel;
    if (route.mode) smartCompact.mode = route.mode;
  }
  return { ...root, smartCompact };
}

export function smartCompactHostSettingsFile(
  home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || os.homedir()
): string {
  return path.join(home, '.pi', 'agent', 'settings.json');
}

/** 只改 HOME 下 Pi 的 smartCompact 段；失败由调用方吞掉。 */
export function persistEnsoSmartCompactSettings(
  file = smartCompactHostSettingsFile(),
  route?: SmartCompactRoute
): void {
  let existing: unknown = null;
  try {
    existing = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    existing = null;
  }
  const next = `${JSON.stringify(mergeSmartCompactSettings(existing, route), null, 2)}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, file);
}
