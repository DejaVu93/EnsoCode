import { describe, expect, it } from 'vitest';
import { isContinuationTurn } from './titleContinuation';

describe('isContinuationTurn：推进类短句不触发滚动总结', () => {
  it.each([
    '开始实施',
    '继续',
    '好的，做吧',
    '好的',
    '可以',
    '下一步',
    '然后呢？',
    '接着',
    '按 PRD 实施',
    'go ahead',
    'ok',
    'OK!',
    'continue',
    'proceed',
    'do it',
    'yes',
    'next',
    '从这里继续',
    '从这里继续：',
  ])('%s → true', (text) => {
    expect(isContinuationTurn(text)).toBe(true);
  });

  it.each([
    '开始实施 dnd-kit 迁移',
    '继续排查节点转圈问题',
    '帮我修一下登录',
    '好的，那把 CoworkerTabs 的拖拽也换掉',
    'continue with the sidebar refactor',
    '这个修复有通用性吗',
    '',
    '   ',
  ])('%s → false', (text) => {
    expect(isContinuationTurn(text)).toBe(false);
  });
});
