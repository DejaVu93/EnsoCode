import { describe, expect, it, vi } from 'vitest';
import { takeReusableSequence } from './chat';
import type { LlamaContextLike, LlamaContextSequenceLike } from './runtime';

function fakeContext(sequenceCount = 1) {
  let left = sequenceCount;
  const sequence: LlamaContextSequenceLike = { clearHistory: vi.fn(async () => {}) };
  const context = {
    getSequence: vi.fn(() => {
      if (left <= 0) throw new Error('No sequences left');
      left -= 1;
      return sequence;
    }),
    dispose: vi.fn(async () => {}),
  };
  return { context: context as unknown as LlamaContextLike, sequence, raw: context };
}

describe('takeReusableSequence', () => {
  it('takes a sequence once and reuses it afterwards', async () => {
    // context 默认只有 1 条 sequence：每轮都 getSequence 会在第二次调用时
    // 抛 "No sequences left"，本地提炼从第二个任务起永久失败（实测复现）。
    const { context, raw } = fakeContext(1);
    const first = await takeReusableSequence(context, null);
    const second = await takeReusableSequence(context, first);
    expect(raw.getSequence).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('clears history when reusing so Complete stays stateless', async () => {
    const { context, sequence } = fakeContext(1);
    const seq = await takeReusableSequence(context, null);
    // 首次取到的是干净的，不必清
    expect(sequence.clearHistory).not.toHaveBeenCalled();
    await takeReusableSequence(context, seq);
    // 复用前必须清历史，否则上一次提炼的内容会泄漏进下一次
    expect(sequence.clearHistory).toHaveBeenCalledTimes(1);
  });

  it('survives a clearHistory failure by taking a fresh sequence', async () => {
    const { context, sequence, raw } = fakeContext(2);
    const seq = await takeReusableSequence(context, null);
    (sequence.clearHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('busy'));
    await expect(takeReusableSequence(context, seq)).resolves.toBeDefined();
    // 清不掉就重新取一条，而不是把脏历史带进下一轮
    expect(raw.getSequence).toHaveBeenCalledTimes(2);
  });
});
