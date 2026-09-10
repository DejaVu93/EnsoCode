import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';
import {
  Check,
  ChevronDown,
  GitBranch,
  House,
  Loader2,
  MessageSquarePlus,
  Pencil,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { DIRTY_MAIN_TREE, worktreeHasPendingWork } from '@/stores/sessions/worktree';
import { useSettingsStore } from '@/stores/settings';
import { worktreeHoverText } from './WorktreeBadge';
import { WorktreeRenameDialog } from './WorktreeRenameDialog';
import { canAttachWorktree, existingProjectWorktrees, worktreeDisplayName } from './worktreeUi';

/**
 * composer 工具行的工作区选择（紧跟预设选择器）：本地工作区 / 隔离 worktree。
 * fresh 会话直接绑定；已开聊会话走完整迁移语义（主树干净检查 + release + 迁移提醒）；
 * 切回本地 = 清理 worktree，有未落地成果时弹确认（分支保留）。
 */
export function WorktreePicker({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const conversation = useSessionsStore((state) => state.conversations[conversationId]);
  const moveConversationToWorktree = useSessionsStore((state) => state.moveConversationToWorktree);
  const cleanupWorktree = useSessionsStore((state) => state.cleanupWorktree);
  const refreshWorktreeStatuses = useSessionsStore((state) => state.refreshWorktreeStatuses);
  const conversations = useSessionsStore((state) => state.conversations);
  const statuses = useSessionsStore((state) => state.worktreeStatuses);
  const attachConversationToWorktree = useSessionsStore(
    (state) => state.attachConversationToWorktree
  );
  const newConversation = useSessionsStore((state) => state.newConversation);
  const [renameEntity, setRenameEntity] = useState<{
    conversationId: string;
    worktree: SessionWorktree;
  } | null>(null);
  const candidates = useMemo(
    () => existingProjectWorktrees(conversations, conversation?.projectId ?? '', statuses),
    [conversations, conversation?.projectId, statuses]
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingCleanup, setPendingCleanup] = useState<WorktreeStatus | null>(null);
  const [dirtyConfirm, setDirtyConfirm] = useState(false);

  const project = useSettingsStore((state) =>
    conversation ? state.projects.find((p) => p.id === conversation.projectId) : undefined
  );
  if (!conversation || conversation.parentId || conversation.child) return null;
  // ssh 远程项目没有本机 git worktree可用,main 也会拒绝——入口直接隐藏
  if (project?.kind === 'ssh') return null;
  const isolated = Boolean(conversation.worktree);
  const disabled =
    busy ||
    conversation.spawning ||
    conversation.status === 'running' ||
    Boolean(conversation.workspaceMigrating || conversation.reloading);
  const missing = conversation.worktreeMissing || statuses[conversationId]?.exists === false;
  const canAttach = canAttachWorktree(conversation);

  const handleWorktreeAction = async (sourceId?: string) => {
    if (disabled) return;
    setBusy(true);
    const title = sourceId ? t('Failed to use worktree') : t('Failed to create conversation');
    try {
      if (sourceId) {
        const error = await attachConversationToWorktree(conversationId, sourceId);
        if (error) addToast({ type: 'error', title, description: error });
      } else if (
        !(await newConversation(conversation.projectId, {
          worktreeFromConversationId: conversationId,
        }))
      ) {
        addToast({ type: 'error', title });
      }
    } catch (error) {
      addToast({ type: 'error', title, description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const runCleanup = async () => {
    setBusy(true);
    try {
      const error = await cleanupWorktree(conversationId);
      if (error) {
        addToast({ type: 'error', title: t('Failed to clean up worktree'), description: error });
      } else {
        void refreshWorktreeStatuses();
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: t('Failed to clean up worktree'),
        description: String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleIsolate = async (allowDirtyMainTree = false) => {
    setBusy(true);
    try {
      const error = await moveConversationToWorktree(conversationId, { allowDirtyMainTree });
      if (error === DIRTY_MAIN_TREE) {
        setDirtyConfirm(true);
      } else if (error) {
        addToast({ type: 'error', title: t('Failed to move to worktree'), description: error });
      } else {
        void refreshWorktreeStatuses();
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: t('Failed to move to worktree'),
        description: String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLocal = async () => {
    setBusy(true);
    try {
      const status = await window.electronAPI.worktree.status(conversationId);
      if (status.ok && worktreeHasPendingWork(status.value)) {
        setPendingCleanup(status.value);
        return;
      }
      await runCleanup();
    } catch (error) {
      addToast({
        type: 'error',
        title: t('Failed to clean up worktree'),
        description: String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const options = [
    {
      id: 'local',
      selected: !isolated,
      icon: <House className="h-3.5 w-3.5 shrink-0" />,
      name: t('Local workspace'),
      hint: t('Work directly in the main working tree'),
      onSelect: () => {
        if (isolated) void handleLocal();
      },
    },
    {
      id: 'worktree',
      selected: isolated,
      icon: <GitBranch className="h-3.5 w-3.5 shrink-0" />,
      name: conversation.worktree
        ? worktreeDisplayName(conversation.worktree)
        : t('New isolated worktree'),
      hint: isolated
        ? conversation.worktree?.branch
        : t('Run this session on its own git worktree'),
      onSelect: () => {
        if (!isolated) void handleIsolate();
      },
    },
  ];

  const dirtyDialog = (
    <ConfirmDialog
      open={dirtyConfirm}
      onOpenChange={setDirtyConfirm}
      title={t('Main working tree has uncommitted changes')}
      description={t(
        'The new worktree branches off HEAD, so those changes stay in the main working tree and will not follow this session.'
      )}
      confirmLabel={t('Move anyway')}
      onConfirm={() => {
        setDirtyConfirm(false);
        void handleIsolate(true);
      }}
    />
  );

  const cleanupWarning = (): string => {
    const parts: string[] = [];
    if (pendingCleanup?.dirty) parts.push(t('Uncommitted changes'));
    if (pendingCleanup && pendingCleanup.ahead > 0)
      parts.push(t('{{n}} unmerged commits (branch is kept)', { n: pendingCleanup.ahead }));
    return parts.join('; ');
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex h-7 min-w-0 max-w-44 shrink items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          title={
            conversation.worktree
              ? worktreeHoverText(conversation.worktree, statuses[conversationId], t)
              : t('Local')
          }
        >
          {busy ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : isolated ? (
            <GitBranch className="h-3 w-3 shrink-0" />
          ) : (
            <House className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 truncate">
            {conversation.worktree ? worktreeDisplayName(conversation.worktree) : t('Local')}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="start"
          className="w-64 [&_[data-slot=popover-viewport]]:p-1"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                option.selected
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {option.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.name}</span>
                {option.hint && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
              {option.selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          ))}
          {canAttach && candidates.length > 0 && (
            <div className="mt-1 border-t pt-1">
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {t('Existing worktrees')}
              </p>
              <div className="max-h-56 overflow-y-auto">
                {candidates.map(({ conversationId: sourceId, worktree }) => (
                  <button
                    key={worktree.path}
                    type="button"
                    disabled={disabled}
                    title={worktreeHoverText(worktree, statuses[sourceId], t)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={() => {
                      setOpen(false);
                      void handleWorktreeAction(sourceId);
                    }}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{worktreeDisplayName(worktree)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {worktree.path}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {conversation.worktree && (
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                disabled={disabled || missing}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  void handleWorktreeAction();
                }}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                {t('New conversation in this worktree')}
              </button>
              <button
                type="button"
                disabled={disabled || missing}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  if (conversation.worktree)
                    setRenameEntity({ conversationId, worktree: conversation.worktree });
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('Rename worktree')}
              </button>
            </div>
          )}
        </PopoverPopup>
      </Popover>
      <ConfirmDialog
        open={pendingCleanup !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setPendingCleanup(null);
        }}
        title={t('Clean up worktree?')}
        description={t(
          'Pending work: {{warning}}. This session returns to the main working tree. The worktree directory and uncommitted changes are removed only when no other sessions use it. The branch is kept.',
          { warning: cleanupWarning() }
        )}
        confirmLabel={t('Clean up')}
        onConfirm={() => {
          setPendingCleanup(null);
          void runCleanup();
        }}
      />
      {dirtyDialog}
      <WorktreeRenameDialog entity={renameEntity} onClose={() => setRenameEntity(null)} />
    </>
  );
}
