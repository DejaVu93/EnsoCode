import { describe, expect, it } from 'vitest';
import {
  applyExploreFold,
  createExploreFoldState,
  createExploreFoldTools,
  type LlmMessage,
} from './exploreFold';

const msg = (role: string, text: string, extra?: Partial<LlmMessage>): LlmMessage => ({
  role,
  content: text,
  ...extra,
});

describe('applyExploreFold', () => {
  it('replaces mark→fold tool rounds with the report', () => {
    const messages: LlmMessage[] = [
      msg('user', 'look around'),
      msg('assistant', 'marking', { toolCalls: [{ name: 'explore_mark' }] }),
      msg('toolResult', 'marked'),
      msg('assistant', 'reading', { toolCalls: [{ name: 'read' }] }),
      msg('toolResult', 'file contents'),
      msg('assistant', 'folding', { toolCalls: [{ name: 'explore_fold' }] }),
      msg('toolResult', 'folded'),
      msg('assistant', 'now implement'),
    ];
    const folded = applyExploreFold(messages, [
      { from: 1, to: 6, report: 'auth is in src/auth.ts' },
    ]);
    expect(folded.map((m) => (typeof m.content === 'string' ? m.content : ''))).toEqual([
      'look around',
      'Explore report:\nauth is in src/auth.ts',
      'now implement',
    ]);
  });

  it('leaves messages unchanged when there are no folds', () => {
    const messages = [msg('user', 'a'), msg('assistant', 'b')];
    expect(applyExploreFold(messages, [])).toBe(messages);
  });
});

describe('createExploreFoldState', () => {
  it('rejects fold without mark and double mark', () => {
    const state = createExploreFoldState();
    expect(() => state.fold('x')).toThrow(/no active explore_mark/i);
    state.mark('goal');
    expect(() => state.mark('again')).toThrow(/already active/i);
    const fold = state.fold('report');
    expect(fold.report).toBe('report');
  });
});

describe('createExploreFoldTools', () => {
  it('explore_fold 的结果正文里带上 report,时间线展开即可看到留存内容', async () => {
    const state = createExploreFoldState();
    const tools = createExploreFoldTools(state);
    const fold = tools.find((tool) => tool.name === 'explore_fold');
    expect(fold).toBeDefined();
    state.mark('goal');
    const result = await fold?.execute(
      'id',
      { report: '  auth 在 src/auth.ts  ' },
      undefined,
      undefined,
      {} as never
    );
    const text = result?.content.map((part) => ('text' in part ? part.text : '')).join('');
    expect(text).toContain('auth 在 src/auth.ts');
    expect(text).toContain('Explore folded.');
  });
});
