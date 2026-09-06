import { describe, expect, it } from 'vitest';
import { idsToClose } from './tabCloseActions';

const ids = ['a', 'b', 'c', 'd'];

describe('idsToClose', () => {
  it('closes only the target', () => {
    expect(idsToClose(ids, 'b', 'self')).toEqual(['b']);
  });

  it('closes every tab except the target', () => {
    expect(idsToClose(ids, 'b', 'others')).toEqual(['a', 'c', 'd']);
  });

  it('closes tabs to the right of the target', () => {
    expect(idsToClose(ids, 'b', 'right')).toEqual(['c', 'd']);
    expect(idsToClose(ids, 'd', 'right')).toEqual([]);
  });

  it('closes saved tabs only', () => {
    const saved = new Set(['a', 'c']);
    expect(idsToClose(ids, 'b', 'saved', (id) => saved.has(id))).toEqual(['a', 'c']);
  });

  it('closes all tabs', () => {
    expect(idsToClose(ids, 'b', 'all')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns empty when the target is not in the list', () => {
    expect(idsToClose(ids, 'missing', 'others')).toEqual([]);
  });
});
