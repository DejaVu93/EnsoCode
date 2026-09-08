import type { CodeViewItem } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CODE_THEME, ensureHighlighter } from '@/components/chat/codeHighlighter';
import { useI18n } from '@/i18n';
import { buildChangeItems, type ChangeItemMemo } from '@/lib/changesItems';
import {
  aggregateSessionChanges,
  type SessionChangeTool,
  sameRecord,
  sameTools,
} from '@/lib/sessionChanges';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { buildTimeline } from '@/stores/sessions/timeline';
import { useSettingsStore } from '@/stores/settings';
import { useSidePanelStore } from '@/stores/sidePanel';

const CODE_VIEW_OPTIONS = {
  themeType: 'system',
  theme: CODE_THEME,
  diffStyle: 'split',
  lineDiffType: 'word',
  preferredHighlighter: 'shiki-js',
  overflow: 'scroll',
  stickyHeaders: true,
} as const;

const CODE_VIEW_STYLE = { height: '100%', overflow: 'auto' } as const;

function resolvePath(root: string | undefined, rel: string): string | null {
  if (!rel) return null;
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  if (!root) return null;
  return `${root.replace(/[/\\]+$/, '')}/${rel}`;
}

export function ChangesView({
  conversationId,
  projectId,
}: {
  conversationId: string;
  projectId: string;
}) {
  const { t } = useI18n();
  const mode = useSidePanelStore((s) => s.changesModeByConversation[conversationId]) ?? 'all';
  const setMode = useSidePanelStore((s) => s.setChangesMode);
  const snapshots = useSidePanelStore((s) => s.snapshotsByConversation[conversationId]) ?? {};
  const saveSnapshots = useSidePanelStore((s) => s.saveSnapshots);

  const conversation = useSessionsStore((s) => s.conversations[conversationId]);
  const project = useSettingsStore((s) => s.projects.find((item) => item.id === projectId));
  const ssh = project?.kind === 'ssh';
  const root = conversation?.worktree?.path ?? project?.path;
  const running = conversation?.status === 'running';
  const timeline = useMemo(
    () =>
      buildTimeline(conversation?.messages ?? [], running, conversation?.customEntries ?? [], root),
    [conversation?.customEntries, conversation?.messages, running, root]
  );

  // 流式每个 chunk 都重建 timeline；tools 内容不变就复用旧引用，否则下游读盘 + 全量 diff 解析每个 token 都跑一遍
  const toolsRef = useRef<SessionChangeTool[]>([]);
  const tools = useMemo(() => {
    const next = timeline.flatMap((item): SessionChangeTool[] => {
      if (item.kind !== 'tool' || item.state !== 'ok') return [];
      if (item.name !== 'edit' && item.name !== 'write') return [];
      if (!item.summary) return [];
      if (item.name === 'edit' && !(item.edits && item.edits.length > 0)) return [];
      if (item.name === 'write' && !item.writeContent) return [];
      return [{ path: item.summary, edits: item.edits, writeContent: item.writeContent }];
    });
    if (sameTools(toolsRef.current, next)) return toolsRef.current;
    toolsRef.current = next;
    return next;
  }, [timeline]);

  const [ready, setReady] = useState(false);
  const [currentByPath, setCurrentByPath] = useState<Record<string, string | null>>({});
  const [gitError, setGitError] = useState<'not-repo' | 'unavailable' | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitFiles, setGitFiles] = useState<{ path: string; oldText: string; newText: string }[]>(
    []
  );

  useEffect(() => {
    let alive = true;
    ensureHighlighter().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'all') return;
    const paths = [...new Set(tools.map((tool) => tool.path))];
    let alive = true;
    void Promise.all(
      paths.map(async (rel) => {
        const abs = resolvePath(root, rel);
        const text = abs ? await window.electronAPI.files.read(abs) : null;
        return [rel, text] as const;
      })
    ).then((entries) => {
      if (!alive) return;
      const next = Object.fromEntries(entries);
      setCurrentByPath((prev) => (sameRecord(prev, next) ? prev : next));
    });
    return () => {
      alive = false;
    };
  }, [mode, root, tools]);

  const allResult = useMemo(
    () => aggregateSessionChanges({ tools, snapshots, currentByPath }),
    [tools, snapshots, currentByPath]
  );

  useEffect(() => {
    if (mode !== 'all') return;
    const next = allResult.snapshots;
    const keys = Object.keys(next);
    if (
      keys.length === Object.keys(snapshots).length &&
      keys.every((key) => snapshots[key] === next[key])
    ) {
      return;
    }
    saveSnapshots(conversationId, next);
  }, [allResult.snapshots, conversationId, mode, saveSnapshots, snapshots]);

  useEffect(() => {
    if (mode !== 'git') return;
    if (ssh) {
      setGitError('unavailable');
      setGitFiles([]);
      return;
    }
    let alive = true;
    setGitLoading(true);
    void window.electronAPI.git.diffHead({ conversationId, projectId }).then((result) => {
      if (!alive) return;
      setGitLoading(false);
      if (!result.ok) {
        setGitError(result.error);
        setGitFiles([]);
        return;
      }
      setGitError(null);
      setGitFiles(
        result.files.map((file) => ({
          path: file.path,
          oldText: file.oldText,
          newText: file.newText,
        }))
      );
    });
    return () => {
      alive = false;
    };
  }, [conversationId, mode, projectId, ssh]);

  const files = mode === 'git' ? gitFiles : allResult.files;
  // 折叠态按 item id 记；折叠的文件 CodeView 只渲 header，不解析不高亮
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const memoRef = useRef<ChangeItemMemo>(new Map());
  const items = useMemo<CodeViewItem[]>(
    () => buildChangeItems(files, collapsedIds, memoRef.current),
    [files, collapsedIds]
  );
  const allCollapsed = items.length > 0 && items.every((item) => item.collapsed);
  const toggleAll = () =>
    setCollapsedIds(allCollapsed ? new Set() : new Set(items.map((item) => item.id)));
  // 默认 header 是库在 shadow DOM 里生成的固定结构，点不到；整块自己画才能整行可点
  const renderCustomHeader = useCallback(
    (item: CodeViewItem) => (
      <ChangeFileHeader item={item} onToggle={() => toggleCollapsed(item.id)} />
    ),
    [toggleCollapsed]
  );

  const emptyText = (() => {
    if (mode === 'git') {
      if (gitError === 'not-repo') return t('Not a git repository.');
      if (gitError === 'unavailable') return t('Git diff is not available for this workspace.');
      return t('No changes relative to HEAD.');
    }
    return t('No file changes in this conversation yet.');
  })();

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 gap-1 border-b px-2 py-1">
        <ModeTab active={mode === 'all'} onClick={() => setMode(conversationId, 'all')}>
          {t('Session')}
        </ModeTab>
        <ModeTab active={mode === 'git'} onClick={() => setMode(conversationId, 'git')}>
          {t('Git')}
        </ModeTab>
        {items.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            title={allCollapsed ? t('Expand all') : t('Collapse all')}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {!ready || (mode === 'git' && gitLoading) || files.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {ready && !(mode === 'git' && gitLoading) ? emptyText : t('Loading...')}
          </div>
        ) : (
          <CodeView
            items={items}
            disableWorkerPool
            style={CODE_VIEW_STYLE}
            options={CODE_VIEW_OPTIONS}
            renderCustomHeader={renderCustomHeader}
          />
        )}
      </div>
    </div>
  );
}

/** 整行可点的文件头：chevron + 路径 + ±行数 */
function ChangeFileHeader({ item, onToggle }: { item: CodeViewItem; onToggle: () => void }) {
  const diff = item.type === 'diff' ? item.fileDiff : null;
  let additions = 0;
  let deletions = 0;
  for (const hunk of diff?.hunks ?? []) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  const name = diff?.name ?? (item.type === 'file' ? item.file.name : '');
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left font-mono text-xs hover:bg-muted/50"
    >
      {item.collapsed ? (
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate" title={name}>
        {name}
      </span>
      {deletions > 0 && <span className="shrink-0 text-red-500">-{deletions}</span>}
      {additions > 0 && <span className="shrink-0 text-green-600">+{additions}</span>}
    </button>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs transition-colors',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  );
}
