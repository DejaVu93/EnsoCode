import { describe, expect, it } from 'vitest';
import { extractCompactFacts } from './extract';
import { patchCompactSummary } from './summarize';
import type { AgentMessage } from './types';
import { keepRecentTail } from './window';

const entries = [
  {
    role: 'user',
    content: 'MUST keep dark mode. Do not use explore_mark. Goal: ship the checkout page.',
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Working on checkout.' },
      { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/checkout.ts' } },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 't1',
    toolName: 'read',
    content: [{ type: 'text', text: 'export function Checkout() {}' }],
  },
  { role: 'assistant', content: 'Error: TypeError: cannot read price' },
  { role: 'user', content: 'Still blocked on price. Also edit src/price.ts' },
] as unknown as AgentMessage[];

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

  it('分别抽出编辑、写入、Hashline 和读取路径', () => {
    const facts = extractCompactFacts([
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'e1', name: 'edit', arguments: { path: 'src/a.ts', edits: [] } },
          { type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'src/b.ts' } },
          {
            type: 'toolCall',
            id: 'e2',
            name: 'edit',
            arguments: { input: '[src/c.ts#ABCD]\nPUT 3 foo' },
          },
          { type: 'toolCall', id: 'r1', name: 'read', arguments: { path: 'src/read.ts' } },
        ],
      },
    ] as unknown as AgentMessage[]);
    expect(facts.modifiedFiles).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    );
    expect(facts.readFiles).toEqual(['src/read.ts']);
    expect(facts.files).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/read.ts'])
    );
  });

  it('只采用最后一次 todo 调用的状态', () => {
    const facts = extractCompactFacts([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 't1',
            name: 'todo',
            arguments: { todos: [{ content: 'X', status: 'completed' }] },
          },
          {
            type: 'toolCall',
            id: 't2',
            name: 'todo',
            arguments: {
              todos: [
                { content: 'Y', status: 'completed' },
                { content: 'Z', status: 'in_progress' },
              ],
            },
          },
        ],
      },
    ] as unknown as AgentMessage[]);
    expect(facts.completedTodos).toEqual(['Y']);
    expect(facts.activeTodos).toEqual(['Z']);
  });

  it('从失败工具结果抽出错误文本', () => {
    const facts = extractCompactFacts([
      {
        role: 'toolResult',
        toolCallId: 'r1',
        toolName: 'read',
        isError: true,
        content: [{ type: 'text', text: 'ENOENT: no such file' }],
      },
    ] as unknown as AgentMessage[]);
    expect(facts.errors).toContain('ENOENT: no such file');
  });

  it('合并 fileOps 中的读写路径', () => {
    const facts = extractCompactFacts([], {
      read: new Set(['x.ts']),
      written: new Set(['y.ts']),
      edited: new Set(),
    });
    expect(facts.readFiles).toContain('x.ts');
    expect(facts.modifiedFiles).toContain('y.ts');
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
      readFiles: [],
      modifiedFiles: [],
      completedTodos: [],
      activeTodos: [],
      openLoops: ['blocked on price'],
    });
    expect(patched).toMatch(/## Goal/);
    expect(patched).toContain('ship checkout');
    expect(patched).toContain('Do not use explore_mark');
    expect(patched).toContain('TypeError');
  });
});
