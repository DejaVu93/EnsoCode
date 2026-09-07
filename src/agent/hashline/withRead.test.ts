import { describe, expect, it, vi } from 'vitest';
import { computeFileHash, formatHashlineHeader } from './format';
import { InMemorySnapshotStore } from './snapshots';
import { withHashlineRead } from './withRead';

const fakeRead = (content: Array<{ type: string; text?: string; data?: string }>) => ({
  name: 'read',
  async execute(_id: string, _params: unknown) {
    return { content };
  },
});

describe('withHashlineRead', () => {
  it('文本文件读取成功后记录快照并加入文件头与行号', async () => {
    const path = '/tmp/a.ts';
    const body = 'alpha\nbeta\n';
    const store = new InMemorySnapshotStore();
    const read = withHashlineRead(fakeRead([{ type: 'text', text: body }]), store);
    const result = await read.execute('call-1', { path });
    const visible = result.content[0]?.text ?? '';
    expect(store.get(path, computeFileHash(body))).toBe(body);
    expect(visible).toContain(formatHashlineHeader(path, computeFileHash(body)));
    expect(visible).toContain('1:alpha');
    expect(visible).toContain('2:beta');
  });

  it('带 offset 的局部读取：按 offset 编号、截断提示不编号、快照记录整文件', async () => {
    const path = '/tmp/big.ts';
    const full = 'l1\nl2\nl3\nl4\nl5\nl6\n';
    const notice = '[Showing lines 3-4 of 6. Use offset=5 to continue.]';
    const store = new InMemorySnapshotStore();
    const read = withHashlineRead(
      fakeRead([{ type: 'text', text: `l3\nl4\n\n${notice}` }]),
      store,
      {
        readFileText: async () => full,
      }
    );
    const result = await read.execute('call-5', { path, offset: 3, limit: 2 });
    const visible = result.content[0]?.text ?? '';
    const tag = computeFileHash(full);
    expect(store.get(path, tag)).toBe(full);
    expect(visible).toBe(`${formatHashlineHeader(path, tag)}\n3:l3\n4:l4\n\n${notice}`);
  });

  it('局部读取但无法读整文件时不加头、不编号、不记录', async () => {
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    const raw = [{ type: 'text', text: 'l3\nl4' }];
    const result = await withHashlineRead(fakeRead(raw), store).execute('call-6', {
      path: '/tmp/big.ts',
      offset: 3,
    });
    expect(record).not.toHaveBeenCalled();
    expect(result.content).toBe(raw);
  });

  it('不记录 agent 虚拟路径', async () => {
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    await withHashlineRead(fakeRead([{ type: 'text', text: 'yield' }]), store).execute('call-2', {
      path: 'agent://x',
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('不记录图片结果', async () => {
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    await withHashlineRead(fakeRead([{ type: 'image', data: 'base64' }]), store).execute('call-3', {
      path: '/tmp/a.png',
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('结果缺少文本内容时不记录', async () => {
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    await withHashlineRead(fakeRead([]), store).execute('call-4', { path: '/tmp/empty' });
    expect(record).not.toHaveBeenCalled();
  });
});
