import { describe, expect, it } from 'vitest';
import { shouldMuteCoworkerCompletionNotification } from './coworkerNotification';

const coworker = { sessionId: 'conversation-1::cw-bob' };
const main = { sessionId: 'conversation-1' };

describe('shouldMuteCoworkerCompletionNotification', () => {
  it('开启时静音 coworker 的完成和失败，提问仍放行', () => {
    expect(
      shouldMuteCoworkerCompletionNotification({ type: 'turn-completed', identity: coworker }, true)
    ).toBe(true);
    expect(
      shouldMuteCoworkerCompletionNotification({ type: 'turn-failed', identity: coworker }, true)
    ).toBe(true);
    expect(
      shouldMuteCoworkerCompletionNotification(
        { type: 'status', status: 'failed', identity: coworker },
        true
      )
    ).toBe(true);
    expect(
      shouldMuteCoworkerCompletionNotification({ type: 'ask-request', identity: coworker }, true)
    ).toBe(false);
    expect(
      shouldMuteCoworkerCompletionNotification(
        { type: 'approval-request', identity: coworker },
        true
      )
    ).toBe(false);
  });

  it('主 agent 完成不静音；关闭开关后 coworker 完成也不静音', () => {
    expect(
      shouldMuteCoworkerCompletionNotification({ type: 'turn-completed', identity: main }, true)
    ).toBe(false);
    expect(
      shouldMuteCoworkerCompletionNotification(
        { type: 'turn-completed', identity: coworker },
        false
      )
    ).toBe(false);
    expect(
      shouldMuteCoworkerCompletionNotification(
        { type: 'turn-completed', sessionId: coworker.sessionId },
        true
      )
    ).toBe(true);
    expect(shouldMuteCoworkerCompletionNotification({ type: 'turn-completed' }, true)).toBe(false);
  });
});
