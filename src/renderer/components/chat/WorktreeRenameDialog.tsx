import type { SessionWorktree } from '@shared/types/worktree';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useSessionsStore } from '@/stores/sessions';

export function WorktreeRenameDialog({
  entity,
  onClose,
}: {
  entity: { conversationId: string; worktree: SessionWorktree } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const renameWorktree = useSessionsStore((state) => state.renameWorktree);
  const [name, setName] = useState(entity?.worktree.name ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(entity?.worktree.name ?? '');
    setBusy(false);
  }, [entity]);

  const save = async () => {
    if (!entity || busy) return;
    setBusy(true);
    try {
      const error = await renameWorktree(entity.conversationId, name.trim());
      if (error)
        addToast({ type: 'error', title: t('Failed to rename worktree'), description: error });
      else onClose();
    } catch (error) {
      addToast({
        type: 'error',
        title: t('Failed to rename worktree'),
        description: String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={entity !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Rename worktree')}</DialogTitle>
          <DialogDescription>
            {t(
              'Only the display name changes, for all sessions in this worktree. Leave empty to use the branch name.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            aria-label={t('Worktree name')}
            maxLength={80}
            placeholder={entity?.worktree.branch}
            value={name}
            disabled={busy}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void save();
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
