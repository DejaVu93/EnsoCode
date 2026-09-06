import { describe, expect, it } from 'vitest';
import { extractCompactFacts } from './extract';
import { patchCompactSummary } from './summarize';
import { keepRecentTail } from './window';

const entries = [
  {
    type: 'message',
    message: {
      role: 'user',
      content: 'MUST keep dark mode. Do not use explore_mark. Goal: ship the checkout page.',
    },
  },
  {
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Working on checkout.' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/checkout.ts' } },
      ],
    },
  },
  {
    type: 'message',
    message: { role: 'toolResult', toolCallId: 't1', content: 'export function Checkout() {}' },
  },
  {
    type: 'message',
    message: { role: 'assistant', content: 'Error: TypeError: cannot read price' },
  },
  {
    type: 'message',
    message: { role: 'user', content: 'Still blocked on price. Also edit src/price.ts' },
  },
];

describe('extractCompactFacts', () => {
  it('抽出硬约束、目标、错误和路径', () => {
    const facts = extractCompactFacts(entries);
    expect(facts.goal).toMatch(/checkout/i);
    expect(facts.constraints.some((c) => /explore_mark/i.test(c))).toBe(true);
    expect(facts.constraints.some((c) => /dark mode/i.test(c))).toBe(true);
    expect(facts.errors.some((e) => /TypeError/i.test(e))).toBe(true);
    expect(facts.files).toEqual(expect.arrayContaining(['src/checkout.ts', 'src/price.ts']));
    expect(facts.openLoops.some((l) => /price/i.test(l))).toBe(true);
  });
});

describe('keepRecentTail', () => {
  it('不成对的工具调用不单独进尾巴', () => {
    const tail = keepRecentTail(
      [
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'open', name: 'read', arguments: { path: 'a.ts' } }],
          },
        },
      ],
      'fast'
    );
    expect(tail).toEqual([]);
  });

  it('fast 比 thorough 留更短尾巴', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      type: 'message',
      message: { role: 'user' as const, content: `turn ${i}` },
    }));
    expect(keepRecentTail(many, 'fast').length).toBeLessThan(
      keepRecentTail(many, 'thorough').length
    );
  });
});

describe('patchCompactSummary', () => {
  it('补上 LLM 漏掉的 goal / constraint / error', () => {
    const patched = patchCompactSummary('# Progress\n- did stuff', {
      goal: 'ship checkout',
      constraints: ['Do not use explore_mark'],
      errors: ['TypeError: cannot read price'],
      files: ['src/checkout.ts'],
      openLoops: ['blocked on price'],
    });
    expect(patched).toMatch(/## Goal/);
    expect(patched).toContain('ship checkout');
    expect(patched).toContain('Do not use explore_mark');
    expect(patched).toContain('TypeError');
  });
});
