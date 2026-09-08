import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ScreenRect } from '@/lib/guestViewOcclusion';
import { useSessionsStore } from '@/stores/sessions';
import { SIDE_PANEL_VERSION, splitLegacySnapshots } from './migrate';

export type ChangesMode = 'all' | 'git';

export const SIDE_PANEL_DEFAULT_WIDTH = 360;
export const SIDE_PANEL_MIN_WIDTH = 280;
export const SIDE_PANEL_MAX_WIDTH = 800;

export type SidePanelUi = { open: boolean; width: number };

interface SidePanelState {
  /** 铺满中间工作区;不 persist,关面板 / 切到关着的会话时清掉 */
  fullscreen: boolean;
  uiByConversation: Record<string, SidePanelUi>;
  /** 可见的原生 guest 矩形（运行态，不持久化）：壁纸按这些矩形挖孔给垫底的 view 透出 */
  browserHoles: Record<string, ScreenRect>;
  /** conversationId -> dockview 序列化布局(分屏结构 + tab 集合) */
  layouts: Record<string, SerializedDockview | undefined>;
  changesModeByConversation: Record<string, ChangesMode>;
  /**
   * Changes「Session」模式的编辑前全文，按会话惰性从主进程回读（运行态，不 persist）。
   * 会话键不存在 = 尚未加载；已加载但无快照为 `{}`。
   */
  snapshotsByConversation: Record<string, Record<string, string>>;
  toggleOpen: () => void;
  ensureOpen: (conversationId?: string) => void;
  nudgeWidth: (delta: number) => void;
  toggleFullscreen: () => void;
  setFullscreen: (fullscreen: boolean) => void;
  saveLayout: (conversationId: string, layout: SerializedDockview) => void;
  setChangesMode: (conversationId: string, mode: ChangesMode) => void;
  saveSnapshots: (conversationId: string, snapshots: Record<string, string>) => void;
  loadSnapshots: (conversationId: string) => void;
  setBrowserHole: (key: string, rect: ScreenRect | null) => void;
}

function clampWidth(width: number): number {
  return Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, width));
}

function activeConversationId(): string | undefined {
  return useSessionsStore.getState().activeId ?? undefined;
}

function uiFor(state: SidePanelState, id: string): SidePanelUi {
  return state.uiByConversation[id] ?? { open: false, width: SIDE_PANEL_DEFAULT_WIDTH };
}

function patchUi(
  state: SidePanelState,
  id: string,
  patch: Partial<SidePanelUi>
): Record<string, SidePanelUi> {
  return { ...state.uiByConversation, [id]: { ...uiFor(state, id), ...patch } };
}

/** 只持久化布局与各会话开关/宽度;pty/xterm 关 tab 时由 dockview onDidRemovePanel 回收,切会话不杀 */
export const useSidePanelStore = create<SidePanelState>()(
  persist(
    (set, get) => ({
      fullscreen: false,
      uiByConversation: {},
      browserHoles: {},
      layouts: {},
      changesModeByConversation: {},
      snapshotsByConversation: {},

      toggleOpen: () => {
        const id = activeConversationId();
        if (!id) return;
        const open = !uiFor(get(), id).open;
        set({
          uiByConversation: patchUi(get(), id, { open }),
          fullscreen: open ? get().fullscreen : false,
        });
      },

      ensureOpen: (conversationId) => {
        const id = conversationId ?? activeConversationId();
        if (!id || uiFor(get(), id).open) return;
        set({ uiByConversation: patchUi(get(), id, { open: true }) });
      },

      nudgeWidth: (delta) => {
        const id = activeConversationId();
        if (!id) return;
        const width = clampWidth(uiFor(get(), id).width + delta);
        set({ uiByConversation: patchUi(get(), id, { width }) });
      },

      toggleFullscreen: () => {
        const id = activeConversationId();
        if (!id) return;
        const { fullscreen } = get();
        if (!uiFor(get(), id).open) {
          set({ uiByConversation: patchUi(get(), id, { open: true }), fullscreen: true });
          return;
        }
        set({ fullscreen: !fullscreen });
      },

      setFullscreen: (fullscreen) => {
        const id = activeConversationId();
        if (fullscreen && id) {
          set({ fullscreen: true, uiByConversation: patchUi(get(), id, { open: true }) });
          return;
        }
        set({ fullscreen });
      },

      setBrowserHole: (key, rect) => {
        const { [key]: prev, ...rest } = get().browserHoles;
        if (!rect && !prev) return;
        set({ browserHoles: rect ? { ...rest, [key]: rect } : rest });
      },

      saveLayout: (conversationId, layout) => {
        set({ layouts: { ...get().layouts, [conversationId]: layout } });
      },

      setChangesMode: (conversationId, mode) => {
        set({
          changesModeByConversation: { ...get().changesModeByConversation, [conversationId]: mode },
        });
      },

      saveSnapshots: (conversationId, snapshots) => {
        set({
          snapshotsByConversation: {
            ...get().snapshotsByConversation,
            [conversationId]: snapshots,
          },
        });
        void window.electronAPI.changes.writeSnapshots({ conversationId, snapshots });
      },

      loadSnapshots: (conversationId) => {
        if (conversationId in get().snapshotsByConversation) return;
        void window.electronAPI.changes.readSnapshots({ conversationId }).then((snapshots) => {
          if (conversationId in get().snapshotsByConversation) return;
          set({
            snapshotsByConversation: {
              ...get().snapshotsByConversation,
              [conversationId]: snapshots,
            },
          });
        });
      },
    }),
    {
      name: 'enso-side-panel',
      version: SIDE_PANEL_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        uiByConversation: state.uiByConversation,
        layouts: state.layouts,
        changesModeByConversation: state.changesModeByConversation,
      }),
      migrate: (persisted, version) => {
        const { state, snapshots } = splitLegacySnapshots(persisted, version);
        // 旧版快照一次性迁到磁盘；失败只是丢 old，Session 模式退回 reconstruct
        const changes = (
          window as { electronAPI?: { changes?: typeof window.electronAPI.changes } }
        ).electronAPI?.changes;
        if (changes) {
          for (const [conversationId, files] of Object.entries(snapshots)) {
            void changes.writeSnapshots({ conversationId, snapshots: files });
          }
        }
        return state as unknown as SidePanelState;
      },
    }
  )
);
