import electronVitePackage from 'electron-vite/package.json';
import vitePackage from 'vite/package.json';
import { describe, expect, it } from 'vitest';
import config from '../../electron.vite.config';
import pkg from '../../package.json';

describe('Electron main build topology', () => {
  it('keeps the official single main entry so isolated modulePath builds the agent worker', () => {
    expect(config.main?.build?.rollupOptions?.input).toBeUndefined();
    expect(config.main?.build?.externalizeDeps).toBe(true);
  });

  it('externalizes every native module that resolves its binding at runtime', () => {
    // externalizeDeps 只 external `dependencies`。optionalDependencies 里的原生模块
    // 会被打进 bundle，其对 .node 绑定的动态 require 随即失效，运行时报
    // `Could not dynamically require "…/onnxruntime_binding.node"`——
    // typecheck 和单测都发现不了，只有真机跑到那条路径才炸。
    const external = config.main?.build?.rollupOptions?.external;
    const list = Array.isArray(external) ? external.map(String) : [String(external)];
    for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
      expect(list, `${name} must stay external`).toContain(name);
    }
  });

  it('keeps Vite within the installed electron-vite peer range', () => {
    const electronViteMajor = Number(electronVitePackage.version.split('.')[0]);
    const viteMajor = Number(vitePackage.version.split('.')[0]);
    if (electronViteMajor === 5) expect(viteMajor).toBeLessThanOrEqual(7);
  });
});
