import { describe, expect, it } from 'vitest';
import { shouldSkipSidePanelWidthAnim } from './sidePanelWidthAnim';

describe('shouldSkipSidePanelWidthAnim', () => {
  it('首次挂载不跳过', () => {
    expect(shouldSkipSidePanelWidthAnim({ resizing: false, conversationId: 'a' })).toBe(false);
  });

  it('拖拽改宽时跳过动画', () => {
    expect(shouldSkipSidePanelWidthAnim({ resizing: true, conversationId: 'a' })).toBe(true);
  });

  it('同一会话开关/全屏不跳过，留给 spring', () => {
    expect(
      shouldSkipSidePanelWidthAnim({
        resizing: false,
        conversationId: 'a',
        previousConversationId: 'a',
      })
    ).toBe(false);
  });

  it('换会话跳过：宽度立切，聊天区不被 spring 拖着重测', () => {
    expect(
      shouldSkipSidePanelWidthAnim({
        resizing: false,
        conversationId: 'b',
        previousConversationId: 'a',
      })
    ).toBe(true);
  });
});
