import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  listeners: new Map<string, (...args: any[]) => unknown>(),
  host: {
    setOverlayActive: vi.fn(),
    setViewport: vi.fn(() => 'state'),
    setDevToolsViewport: vi.fn(() => 'state'),
    resetOverlayReports: vi.fn(),
    state: vi.fn(() => 'empty'),
    onState: vi.fn(),
    onReveal: vi.fn(),
    onTabClosed: vi.fn(),
    onDesignMode: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
    on: (channel: string, handler: (...args: any[]) => unknown) => {
      mocks.listeners.set(channel, handler);
    },
  },
}));
vi.mock('../services/browserHost', () => ({ browserHost: mocks.host }));
vi.mock('../windows/createAppWindow', () => ({ sendToAllWindows: () => {} }));
vi.mock('../windows/MainWindow', () => ({ isMainWebContents: (id: number) => id === 1 }));

import { IPC_CHANNELS } from '@shared/types';
import { registerBrowserHandlers } from './browser';

const sender = (id: number) => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    id,
    on(name: string, fn: (...args: any[]) => void) {
      listeners[name] = [...(listeners[name] ?? []), fn];
    },
    emit(name: string, ...args: any[]) {
      for (const fn of listeners[name] ?? []) fn(...args);
    },
  };
};

beforeEach(() => {
  mocks.handlers.clear();
  mocks.listeners.clear();
  for (const fn of Object.values(mocks.host)) fn.mockClear();
  registerBrowserHandlers();
});

it('浮层 / 矩形上报只认主窗口 renderer', () => {
  const overlay = mocks.listeners.get(IPC_CHANNELS.BROWSER_SET_OVERLAY_ACTIVE)!;
  const setViewport = mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_VIEWPORT)!;
  const setDevtoolsViewport = mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_DEVTOOLS_VIEWPORT)!;

  overlay({ sender: sender(2) }, true);
  expect(mocks.host.setOverlayActive).not.toHaveBeenCalled();
  setViewport({ sender: sender(2) }, 'tab', 'conv', null, true);
  expect(mocks.host.setViewport).not.toHaveBeenCalled();
  setDevtoolsViewport({ sender: sender(2) }, 'tab', 'conv', null, true);
  expect(mocks.host.setDevToolsViewport).not.toHaveBeenCalled();

  overlay({ sender: sender(1) }, true);
  expect(mocks.host.setOverlayActive).toHaveBeenCalledWith(true);
  setViewport({ sender: sender(1) }, 'tab', 'conv', null, true);
  expect(mocks.host.setViewport).toHaveBeenCalledWith('tab', 'conv', null, true);
});

it('上报方崩溃 / 销毁 / 整页重载后清掉浮层闩锁', () => {
  const overlay = mocks.listeners.get(IPC_CHANNELS.BROWSER_SET_OVERLAY_ACTIVE)!;

  const crashed = sender(1);
  overlay({ sender: crashed }, true);
  crashed.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(1);
  crashed.emit('destroyed');
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(2);

  const reloaded = sender(1);
  overlay({ sender: reloaded }, true);
  reloaded.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  reloaded.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(2);
  reloaded.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(3);
});
