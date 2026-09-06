import { randomUUID } from 'node:crypto';
import { parseAppCloseResponse, shouldBypassCloseConfirm } from '@shared/appClose';
import { IPC_CHANNELS } from '@shared/types';
import { app, ipcMain, type WebContents } from 'electron';
import { autoUpdaterService } from './updater/AutoUpdater';

const CLOSE_RESPONSE_TIMEOUT_MS = 30_000;

export interface AppCloseConfirmHost {
  isDestroyed(): boolean;
  on(event: 'close', listener: (event: Electron.Event) => void): void;
  once(event: 'closed', listener: () => void): void;
  removeListener(event: 'closed', listener: () => void): void;
}

export function attachAppCloseConfirm(
  win: AppCloseConfirmHost,
  send: (channel: string, ...args: unknown[]) => void,
  contentsOf: () => WebContents
): void {
  let allowQuit = false;
  let flowInProgress = false;

  const askRenderer = (): Promise<boolean> => {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      const finalize = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener(IPC_CHANNELS.APP_CLOSE_RESPONSE, onResponse);
        try {
          win.removeListener('closed', gone);
        } catch {
          /* window already gone */
        }
        try {
          contentsOf().removeListener('destroyed', gone);
        } catch {
          /* contents already gone */
        }
        resolve(value);
      };
      const gone = () => finalize(false);
      const onResponse = (event: Electron.IpcMainEvent, incomingId: unknown, payload: unknown) => {
        if (event.sender !== contentsOf()) return;
        const parsed = parseAppCloseResponse(requestId, incomingId, payload);
        if (!parsed) return;
        finalize(parsed.allow);
      };
      const timer = setTimeout(() => finalize(false), CLOSE_RESPONSE_TIMEOUT_MS);
      ipcMain.on(IPC_CHANNELS.APP_CLOSE_RESPONSE, onResponse);
      win.once('closed', gone);
      contentsOf().once('destroyed', gone);
      send(IPC_CHANNELS.APP_CLOSE_REQUEST, requestId);
    });
  };

  const beginConfirm = async () => {
    if (flowInProgress) return;
    flowInProgress = true;
    try {
      if (win.isDestroyed() || contentsOf().isDestroyed()) return;
      const confirmed = await askRenderer();
      if (!confirmed) return;
      allowQuit = true;
      flowInProgress = false;
      app.quit();
    } finally {
      flowInProgress = false;
    }
  };

  const shouldPass = () =>
    shouldBypassCloseConfirm({
      allowQuit,
      quittingForUpdate: autoUpdaterService.isQuittingForUpdate(),
    });

  win.on('close', (event) => {
    if (shouldPass()) return;
    event.preventDefault();
    void beginConfirm();
  });

  const onBeforeQuit = (event: Electron.Event) => {
    if (shouldPass()) return;
    event.preventDefault();
    void beginConfirm();
  };
  app.on('before-quit', onBeforeQuit);
  win.once('closed', () => {
    app.removeListener('before-quit', onBeforeQuit);
  });
}
