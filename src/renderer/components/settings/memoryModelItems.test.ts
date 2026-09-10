import type { EmbeddingModelDto } from '@shared/memory/dto';
import { describe, expect, it } from 'vitest';
import { embeddingModelLabel } from './memoryModelItems';

const model = (id: string) => ({ id }) as EmbeddingModelDto;

describe('embeddingModelLabel', () => {
  it('strips the local/remote prefix', () => {
    expect(embeddingModelLabel(model('local:bge-m3-gguf'))).toBe('bge-m3-gguf');
    expect(embeddingModelLabel(model('remote:text-embedding-3-small'))).toBe(
      'text-embedding-3-small'
    );
  });

  it('spells out what "none" actually means', () => {
    // 直接显示 "none" 会让人以为坏了，而不是「只用全文检索」
    expect(embeddingModelLabel(model('none'))).toBe('None (full-text only)');
  });
});
