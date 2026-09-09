import { describe, expect, it } from 'vitest';
import { classifyEditArgs } from './classify';

describe('classifyEditArgs', () => {
  it('识别 Hashline 补丁参数', () => {
    expect(classifyEditArgs({ input: 'PUT 1.=1:\n+x' })).toEqual({ kind: 'hashline' });
  });

  it('识别 edits 数组替换参数', () => {
    expect(classifyEditArgs({ path: '/a.ts', edits: [{ oldText: 'a', newText: 'b' }] })).toEqual({
      kind: 'replace',
    });
  });

  it('识别遗留的 oldText 与 newText 替换参数', () => {
    expect(classifyEditArgs({ oldText: 'a', newText: 'b' })).toEqual({ kind: 'replace' });
  });

  it('input 与非空 edits 混发时 replace 优先（精确匹配自校验）', () => {
    expect(classifyEditArgs({ input: 'PUT...', edits: [{ oldText: 'a', newText: 'b' }] })).toEqual({
      kind: 'replace',
    });
    expect(classifyEditArgs({ input: 'PUT...', oldText: 'a', newText: 'b' })).toEqual({
      kind: 'replace',
    });
  });

  it('input 与空壳 replace 字段混发时走 hashline（模型顺手填的占位）', () => {
    expect(classifyEditArgs({ input: 'PUT...', edits: [] })).toEqual({ kind: 'hashline' });
    expect(classifyEditArgs({ input: 'PUT...', oldText: '', newText: '' })).toEqual({
      kind: 'hashline',
    });
    expect(classifyEditArgs({ input: 'PUT...', path: '/a.ts' })).toEqual({ kind: 'hashline' });
  });

  it('把缺失或类型错误的形状归为无效参数', () => {
    const invalid = [
      null,
      42,
      {},
      { input: 42 },
      { input: '' },
      { edits: {} },
      { oldText: 'a' },
      { newText: 'b' },
    ];
    for (const value of invalid) expect(classifyEditArgs(value)).toEqual({ kind: 'invalid' });
  });
});
