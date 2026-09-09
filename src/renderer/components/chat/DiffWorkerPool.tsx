import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import type { WorkerInitializationRenderOptions } from '@pierre/diffs/worker';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import type { ReactNode } from 'react';
import { CODE_THEME, LANGS } from './codeHighlighter';

// shiki 的 JS 正则引擎同步高亮 100 KB 源码要 2s+；放 worker 里主线程才不被卡住。
// 没挂这个 provider 的 CodeView/FileDiff 会退回主线程高亮。
const POOL_OPTIONS = { workerFactory: () => new DiffWorker(), poolSize: 2 };
const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: CODE_THEME,
  langs: [...LANGS],
  preferredHighlighter: 'shiki-js',
};

export function DiffWorkerPool({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      {children}
    </WorkerPoolContextProvider>
  );
}
