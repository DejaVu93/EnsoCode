import type { SshHostKeyChallenge } from '@shared/types';

export function hostKeyFromSshFailure(
  result: { error: string; hostKey?: SshHostKeyChallenge },
  fallback?: { host: string; port?: number }
): SshHostKeyChallenge | null {
  if (result.hostKey) return result.hostKey;
  if (!/主机密钥未信任/.test(result.error) || !fallback?.host) return null;
  return {
    host: fallback.host,
    port: fallback.port && fallback.port !== 22 ? fallback.port : 22,
    fingerprint: '',
    keyType: '',
  };
}

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
              {challenge.port !== 22 ? `:${challenge.port}` : ''}
              {challenge.keyType ? ` · ${challenge.keyType}` : ''}
            </p>
            {challenge.fingerprint ? (
              <p className="break-all text-muted-foreground">{challenge.fingerprint}</p>
            ) : null}
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
