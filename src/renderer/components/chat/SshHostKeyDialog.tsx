import type { SshHostKeyChallenge } from '@shared/types';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

export function SshHostKeyDialog({
  challenge,
  nested = false,
  busy = false,
  onTrust,
  onDismiss,
}: {
  challenge: SshHostKeyChallenge | null;
  nested?: boolean;
  busy?: boolean;
  onTrust: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={challenge !== null} onOpenChange={(open) => !open && onDismiss()}>
      <AlertDialogPopup className="sm:max-w-md" zIndexLevel={nested ? 'nested' : 'base'}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{t('Unknown SSH host')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('Trust this host and add its key to known_hosts?')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {challenge && (
          <div className="space-y-1 px-6 pb-2 font-mono text-xs">
            <p>
              {challenge.host}
              {challenge.port !== 22 ? `:${challenge.port}` : ''} · {challenge.keyType}
            </p>
            <p className="break-all text-muted-foreground">{challenge.fingerprint}</p>
          </div>
        )}
        <AlertDialogFooter variant="bare">
          <AlertDialogClose render={<Button variant="outline" size="sm" disabled={busy} />}>
            {t('Cancel')}
          </AlertDialogClose>
          <Button size="sm" disabled={busy} onClick={onTrust}>
            {t('Trust')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
