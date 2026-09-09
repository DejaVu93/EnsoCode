import { describe, expect, it } from 'vitest';
import { estimateMessageTokens, imageTokens, selectKeptBoundary, sendBudget } from './budget';

const preparation = (firstKeptEntryId: string) => ({ firstKeptEntryId, tokensBefore: 10_000 });

describe('compact budget', () => {
  it('短图至少按 1600 token 计价，长图按 base64 字符数估算', () => {
    expect(imageTokens({ data: 'abc' })).toBeGreaterThanOrEqual(1_600);
    const data = 'x'.repeat(8_000);
    expect(imageTokens({ data })).toBe(Math.ceil(data.length / 4));
    expect(imageTokens({ data })).toBeGreaterThan(1_200);
  });

  it('估算助手消息时忽略 usage.totalTokens', () => {
    expect(
      estimateMessageTokens({ role: 'assistant', content: 'tiny', usage: { totalTokens: 999_999 } })
    ).toBeLessThan(10);
  });

  it('图片超过发送预算时将图片工具调用及结果一并移出尾巴', () => {
    const contextWindow = 18_184;
    const data = 'x'.repeat((sendBudget(contextWindow) + 1) * 4);
    const branch = [
      {
        id: 'call',
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'img', name: 'read' }] },
      },
      {
        id: 'result',
        type: 'message',
        message: { role: 'toolResult', toolCallId: 'img', content: [{ type: 'image', data }] },
      },
      { id: 'later', type: 'message', message: { role: 'user', content: 'continue' } },
    ];
    expect(
      selectKeptBoundary({
        branch,
        preparation: preparation('call'),
        contextWindow,
        summaryTokenHint: 0,
      })
    ).toMatchObject({ firstKeptEntryId: 'later' });
  });

  it('尾巴内助手的有效 usage 超过发送预算时推进到该助手之后', () => {
    const contextWindow = 18_184;
    const branch = [
      {
        id: 'assistant',
        type: 'message',
        message: {
          role: 'assistant',
          content: 'tiny',
          usage: { totalTokens: sendBudget(contextWindow) + 1 },
        },
      },
      { id: 'later', type: 'message', message: { role: 'user', content: 'continue' } },
    ];
    expect(
      selectKeptBoundary({
        branch,
        preparation: preparation('assistant'),
        contextWindow,
        summaryTokenHint: 0,
      })
    ).toMatchObject({ firstKeptEntryId: 'later' });
  });

  it('最小合法尾巴仍超过发送预算时报告不可压缩', () => {
    const contextWindow = 16_484;
    const branch = [
      { id: 'only', type: 'message', message: { role: 'user', content: 'x'.repeat(404) } },
    ];
    expect(
      selectKeptBoundary({
        branch,
        preparation: preparation('only'),
        contextWindow,
        summaryTokenHint: 0,
      })
    ).toEqual({ fail: 'uncompressible' });
  });

  it('本次估算相比上次节省不足一成时报告无有效节省', () => {
    const branch = [{ id: 'only', type: 'message', message: { role: 'user', content: 'xxxx' } }];
    expect(
      selectKeptBoundary({
        branch,
        preparation: preparation('only'),
        summaryTokenHint: 99,
        previousEstimatedAfter: 105,
      })
    ).toEqual({ fail: 'no_saving' });
  });
});
