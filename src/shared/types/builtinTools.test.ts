import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOLS,
  DEFAULT_DISABLED_BUILTIN_TOOLS,
  effectiveDisabledBuiltinTools,
} from './builtinTools';

describe('effectiveDisabledBuiltinTools', () => {
  it('缺字段时用默认关闭列表：memory 默认关，其余全开', () => {
    expect(effectiveDisabledBuiltinTools(undefined)).toEqual(['memory']);
    for (const id of DEFAULT_DISABLED_BUILTIN_TOOLS) {
      expect(
        BUILTIN_TOOLS.some((tool) => tool.id === id),
        id
      ).toBe(true);
    }
  });

  it('用户显式存了空列表 = 全开（不重新叠加默认关闭）', () => {
    expect(effectiveDisabledBuiltinTools([])).toEqual([]);
  });

  it('只保留字符串 id，列表原样透传', () => {
    expect(effectiveDisabledBuiltinTools(['browser', 1, 'isolated_sandbox'])).toEqual([
      'browser',
      'isolated_sandbox',
    ]);
  });
});
