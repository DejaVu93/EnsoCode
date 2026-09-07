import { describe, expect, it, vi } from 'vitest';
import {
  bumpPairMetaEpoch,
  flushChangedMeta,
  type PairMetaConn,
  requestPairMeta,
} from './pairMetaFlush';

const ok = () => vi.fn(async () => true);
const fail = () => vi.fn(async () => false);

describe('flushChangedMeta', () => {
  it('commits every channel whose sender succeeds', async () => {
    const senders = { catalog: ok(), projects: ok(), providers: ok() };
    const next = { catalog: 'c1', projects: 'p1', providers: 'v1' };
    await expect(flushChangedMeta(undefined, next, senders)).resolves.toEqual(next);
    for (const send of Object.values(senders)) expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous fingerprint for a failed channel', async () => {
    const result = await flushChangedMeta(
      { catalog: 'c0' },
      { catalog: 'c1', providers: 'v1' },
      { catalog: fail(), providers: ok() }
    );
    expect(result.providers).toBe('v1');
    expect(result.catalog).not.toBe('c1');
  });

  it('calls no sender when nothing changed', async () => {
    const catalog = ok();
    const last = { catalog: 'c1' };
    await expect(flushChangedMeta(last, { catalog: 'c1' }, { catalog })).resolves.toEqual(last);
    expect(catalog).not.toHaveBeenCalled();
  });

  it('abandons remaining sends after a mid-flush epoch bump', async () => {
    const conn: PairMetaConn = { metaDirty: false, metaSending: false, metaEpoch: 1 };
    const catalog = vi.fn(async () => {
      bumpPairMetaEpoch(conn);
      return true;
    });
    const providers = ok();
    await flushChangedMeta(
      undefined,
      { catalog: 'c1', providers: 'v1' },
      { catalog, providers },
      conn
    );
    expect(conn.sentMeta).toBeUndefined();
    expect(providers).not.toHaveBeenCalled();
  });
});

describe('requestPairMeta', () => {
  it('coalesces requests arriving while a run is in flight', async () => {
    const conn: PairMetaConn = { metaDirty: false, metaSending: false };
    let release!: () => void;
    let runs = 0;
    const run = vi.fn(async () => {
      runs += 1;
      if (runs === 1) await new Promise<void>((resolve) => (release = resolve));
    });
    requestPairMeta(conn, run);
    requestPairMeta(conn, run);
    requestPairMeta(conn, run);
    expect(runs).toBe(1);
    release();
    await vi.waitFor(() => expect(runs).toBe(2));
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
