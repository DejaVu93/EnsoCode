import type { EmbeddingModelDto } from '@shared/memory/dto';

/** 下拉标签：注册表 id 去掉 local:/remote: 前缀；none 要说清是「只用全文检索」 */
export function embeddingModelLabel(model: EmbeddingModelDto): string {
  if (model.id === 'none') return 'None (full-text only)';
  return model.id.replace(/^(local|remote):/, '');
}
