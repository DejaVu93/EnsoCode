import type { EmbedKind } from '../types';
import type { EmbeddingModelSpec } from './types';

export function withPrefix(spec: EmbeddingModelSpec, kind: EmbedKind, text: string): string {
  return `${spec.prefix[kind]}${text}`;
}
