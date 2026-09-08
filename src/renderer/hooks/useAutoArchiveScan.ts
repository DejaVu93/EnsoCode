import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';

function bothHydrated(): boolean {
  return useSessionsStore.persist.hasHydrated() && useSettingsStore.persist.hasHydrated();
}

function scanIdleArchive(idleDays: number): void {
  if (!bothHydrated()) return;
  if (!(idleDays > 0)) return;
  useSessionsStore.getState().autoArchiveStaleConversations();
}

function scanMergedWorktrees(enabled: boolean): void {
  if (!bothHydrated() || !enabled) return;
  void useSessionsStore.getState().refreshWorktreeStatuses();
}

function scanDeleteArchived(days: number): void {
  if (!bothHydrated() || !(days > 0)) return;
  useSessionsStore.getState().autoDeleteStaleArchived();
}

/** 主窗：两边 persist 水合后、以及归档相关设置变化后各扫一次。设置窗不挂。 */
export function useAutoArchiveScan(): void {
  const idleDays = useSettingsStore((state) => state.autoArchiveIdleDays);
  const mergedEnabled = useSettingsStore((state) => state.autoArchiveMergedWorktrees);
  const deleteDays = useSettingsStore((state) => state.autoDeleteArchivedDays);
  useEffect(() => {
    if (bothHydrated()) {
      scanIdleArchive(idleDays);
      scanMergedWorktrees(mergedEnabled);
      scanDeleteArchived(deleteDays);
      return;
    }
    const scan = () => {
      scanIdleArchive(idleDays);
      scanMergedWorktrees(mergedEnabled);
      scanDeleteArchived(deleteDays);
    };
    const unsubs = [
      useSessionsStore.persist.onFinishHydration(scan),
      useSettingsStore.persist.onFinishHydration(scan),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idleDays, mergedEnabled, deleteDays]);
}
