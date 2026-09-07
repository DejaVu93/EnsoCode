import { describe, expect, it } from 'vitest';
import { projectResumeTail } from './resumeSnapshots';

const msg = (text: string) => ({
  role: 'user',
  content: [{ type: 'text', text }],
});

describe('projectResumeTail', () => {
  it('短历史只投一次，不拆全量', () => {
    const raw = [msg('a'), msg('b')];
    const { immediate, deferFull } = projectResumeTail(raw);
    expect(deferFull).toBe(false);
    expect(immediate.baseIndex).toBe(0);
    expect(immediate.messages).toHaveLength(2);
  });

  it('长历史立刻只投尾窗，全量另包', () => {
    const raw = Array.from({ length: 80 }, (_, i) => msg(`m${i}`));
    const { immediate, deferFull } = projectResumeTail(raw);
    expect(deferFull).toBe(true);
    expect(immediate.baseIndex).toBe(20);
    expect(immediate.messages).toHaveLength(60);
  });
});
