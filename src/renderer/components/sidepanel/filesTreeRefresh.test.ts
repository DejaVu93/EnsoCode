import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { ancestorDirs, applyCompletedWrites } from './filesTreeRefresh';

const write = (over: Partial<Extract<TimelineItem, { kind: 'tool' }>> = {}): TimelineItem => ({
  kind: 'tool',
  key: over.key ?? '1-write',
  name: 'write',
  summary: over.summary ?? 'src/new.ts',
  output: 'output' in over ? (over.output ?? null) : 'ok',
  state: over.state ?? 'ok',
  edits: null,
  writeContent: 'writeContent' in over ? (over.writeContent ?? null) : 'export {}',
  todos: null,
  durationMs: 'durationMs' in over ? (over.durationMs ?? null) : 8,
  agentMeta: null,
});

const edit = (): TimelineItem => ({
  kind: 'tool',
  key: '1-edit',
  name: 'edit',
  summary: 'src/old.ts',
  output: 'ok',
  state: 'ok',
  edits: [{ oldText: 'a', newText: 'b' }],
  writeContent: null,
  todos: null,
  durationMs: 8,
  agentMeta: null,
});

describe('ancestorDirs', () => {
  it('lists every parent of a nested file', () => {
    expect(ancestorDirs('src/foo/bar.ts')).toEqual(['src', 'src/foo']);
  });

  it('strips a leading ./ before listing parents', () => {
    expect(ancestorDirs('./src/foo/bar.ts')).toEqual(['src', 'src/foo']);
  });

  it('returns empty for a workspace-root file', () => {
    expect(ancestorDirs('readme.md')).toEqual([]);
  });

  it('returns empty for out-of-tree paths', () => {
    expect(ancestorDirs('/tmp/x.ts')).toEqual([]);
    expect(ancestorDirs('../out.ts')).toEqual([]);
  });
});

describe('applyCompletedWrites', () => {
  it('seeds historical writes without requesting a refresh', () => {
    const result = applyCompletedWrites([write({ key: 'old' })], null);
    expect(result.refreshRels).toEqual([]);
    expect([...(result.nextSeen ?? [])]).toEqual(['old']);
  });

  it('refreshes only newly completed writes', () => {
    const result = applyCompletedWrites(
      [write({ key: 'old', summary: 'a.ts' }), write({ key: 'new', summary: 'src/b.ts' })],
      new Set(['old'])
    );
    expect(result.refreshRels).toEqual(['src/b.ts']);
    expect(result.nextSeen?.has('new')).toBe(true);
  });

  it('ignores edit and speculative write', () => {
    const result = applyCompletedWrites(
      [edit(), write({ key: 'ghost', output: null, durationMs: null })],
      new Set()
    );
    expect(result.refreshRels).toEqual([]);
    expect(result.nextSeen?.size).toBe(0);
  });

  it('refreshes a completed empty write', () => {
    const result = applyCompletedWrites(
      [write({ key: 'empty', summary: 'src/blank.ts', writeContent: null })],
      new Set()
    );
    expect(result.refreshRels).toEqual(['src/blank.ts']);
  });

  it('stays in seed mode until history is authoritative', () => {
    const result = applyCompletedWrites([write({ key: 'old' })], new Set(), false);
    expect(result.refreshRels).toEqual([]);
    expect(result.nextSeen).toBeNull();
  });

  it('seeds out-of-tree writes without expanding them', () => {
    const result = applyCompletedWrites(
      [
        write({ key: 'abs', summary: '/tmp/x.ts' }),
        write({ key: 'up', summary: '../out.ts' }),
        write({ key: 'dot', summary: './src/a.ts' }),
      ],
      new Set()
    );
    expect(result.refreshRels).toEqual(['src/a.ts']);
    expect([...(result.nextSeen ?? [])]).toEqual(['abs', 'up', 'dot']);
  });

  it('finds a completed write nested in a tool group', () => {
    const nested = write({ key: 'nested', summary: 'src/c.ts' });
    const result = applyCompletedWrites(
      [
        {
          kind: 'tool-group',
          key: 'g1',
          expanded: false,
          count: 1,
          stats: { commands: 0, reads: 0, searches: 0, others: 1 },
          exploring: false,
          children: [nested],
        },
      ],
      new Set()
    );
    expect(result.refreshRels).toEqual(['src/c.ts']);
  });
});
