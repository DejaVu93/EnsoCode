import {
  changedMetaChannels,
  type PairMetaChannel,
  type PairMetaFingerprints,
} from '@shared/pair/metaSync';

export interface PairMetaConn {
  sentMeta?: PairMetaFingerprints;
  metaDirty: boolean;
  metaSending: boolean;
  metaEpoch?: number;
}

export function requestPairMeta<T extends PairMetaConn>(
  conn: T,
  run: (conn: T) => Promise<void>
): void {
  conn.metaDirty = true;
  if (conn.metaSending) return;
  conn.metaSending = true;
  void (async () => {
    try {
      while (conn.metaDirty) {
        conn.metaDirty = false;
        await run(conn);
      }
    } catch (error) {
      console.warn('[pair] meta flush failed', error);
    } finally {
      conn.metaSending = false;
      if (conn.metaDirty) requestPairMeta(conn, run);
    }
  })();
}

export function bumpPairMetaEpoch(conn: PairMetaConn): void {
  conn.metaEpoch = (conn.metaEpoch ?? 0) + 1;
  conn.sentMeta = undefined;
}

export async function flushChangedMeta(
  last: PairMetaFingerprints | undefined,
  next: PairMetaFingerprints,
  senders: Partial<Record<PairMetaChannel, () => Promise<boolean>>>,
  conn?: PairMetaConn
): Promise<PairMetaFingerprints> {
  const epoch = conn?.metaEpoch ?? 0;
  let committed: PairMetaFingerprints = { ...last };
  for (const channel of changedMetaChannels(last, next)) {
    if (conn && (conn.metaEpoch ?? 0) !== epoch) return conn.sentMeta ?? {};
    const send = senders[channel];
    const fingerprint = next[channel];
    if (!send || fingerprint === undefined) continue;
    if (await send()) {
      if (conn && (conn.metaEpoch ?? 0) !== epoch) return conn.sentMeta ?? {};
      committed = { ...committed, [channel]: fingerprint };
      if (conn) conn.sentMeta = committed;
    }
  }
  return committed;
}
