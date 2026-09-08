import { app, type BrowserWindow } from 'electron';
import { attachAppCloseConfirm } from '../services/appCloseConfirm';
import { createAppWindow, getWindowWebContents, sendToWindow } from './createAppWindow';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = createAppWindow({
    entry: 'index',
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    stateFile: 'window-state.json',
    pinWorkbenchView: true,
  });

  // dev 不弹退出确认：终端 Ctrl+C 杀掉 electron-vite 后 Electron 会卡在确认框上变孤儿
  // （主进程接不到 SIGINT，Chromium 直接转成 app.quit()）
  if (app.isPackaged) {
    attachAppCloseConfirm(
      mainWindow,
      (channel, ...args) => {
        if (mainWindow && !mainWindow.isDestroyed()) sendToWindow(mainWindow, channel, ...args);
      },
      () => getWindowWebContents(mainWindow as BrowserWindow)
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function isMainWebContents(webContentsId: number): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const contents = getWindowWebContents(mainWindow);
  return !contents.isDestroyed() && contents.id === webContentsId;
}

export function focusMainWindow(): BrowserWindow {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}
