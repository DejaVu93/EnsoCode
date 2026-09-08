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

/** 主窗：两边 persist 水合后、以及闲置天数变化后各扫一次。设置窗不持有 sessions，不挂。 */
export function useAutoArchiveScan(): void {
  const idleDays = useSettingsStore((state) => state.autoArchiveIdleDays);
  useEffect(() => {
    if (bothHydrated()) {
      scanIdleArchive(idleDays);
      return;
    }
    const scan = () => scanIdleArchive(idleDays);
    const unsubs = [
      useSessionsStore.persist.onFinishHydration(scan),
      useSettingsStore.persist.onFinishHydration(scan),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idleDays]);
}
