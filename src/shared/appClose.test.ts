import { describe, expect, it } from 'vitest';
import { parseAppCloseResponse, shouldBypassCloseConfirm } from './appClose';

describe('shouldBypassCloseConfirm', () => {
  it('blocks the first close or quit', () => {
    expect(shouldBypassCloseConfirm({ allowQuit: false, quittingForUpdate: false })).toBe(false);
  });

  it('skips after the user confirms or an update install starts', () => {
    expect(shouldBypassCloseConfirm({ allowQuit: true, quittingForUpdate: false })).toBe(true);
    expect(shouldBypassCloseConfirm({ allowQuit: false, quittingForUpdate: true })).toBe(true);
  });
});

describe('parseAppCloseResponse', () => {
  it('accepts only the current request id and a boolean confirmed', () => {
    expect(parseAppCloseResponse('r1', 'r1', { confirmed: true })).toEqual({ allow: true });
    expect(parseAppCloseResponse('r1', 'r1', { confirmed: false })).toEqual({ allow: false });
  });

  it('ignores stale or malformed replies', () => {
    expect(parseAppCloseResponse('r1', 'r2', { confirmed: true })).toBeNull();
    expect(parseAppCloseResponse('r1', 'r1', { confirmed: 'yes' })).toBeNull();
    expect(parseAppCloseResponse('r1', 'r1', null)).toBeNull();
  });
});
