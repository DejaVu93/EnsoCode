import { describe, expect, it } from 'vitest';
import { stripHashlineRead } from './hashlineRead';

describe('stripHashlineRead', () => {
  it('剥掉 [path#TAG] 头与 N: 行号 gutter', () => {
    const input = '[/tmp/a.ts#1A2B]\n1:const a = 1;\n2:\n3:  b: 2';
    expect(stripHashlineRead(input)).toBe('const a = 1;\n\n  b: 2');
  });

  it('尾部截断提示不带编号时原样保留', () => {
    const input =
      '[/tmp/a.ts#1A2B]\n5:x\n6:y\n\n[Showing lines 5-6 of 9. Use offset=7 to continue.]';
    expect(stripHashlineRead(input)).toBe(
      'x\ny\n\n[Showing lines 5-6 of 9. Use offset=7 to continue.]'
    );
  });

  it('没有 Hashline 头的文本原样返回', () => {
    expect(stripHashlineRead('1:not hashline\n2:plain')).toBe('1:not hashline\n2:plain');
    expect(stripHashlineRead('')).toBe('');
  });
});
