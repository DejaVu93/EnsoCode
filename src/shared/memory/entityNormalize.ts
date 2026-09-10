import { KG_MAX_LABEL_CHARS } from './constants';

/**
 * 实体去重键：NFC → 小写 → 去掉全部空白 / 连字符 / 下划线。
 * 同一实体的不同书写（`PostgreSQL` / `postgre sql` / `Postgre-SQL`）落到同一键；中文不做分词或简繁转换。
 * 不做词干化、不去标点：那会把 `C++` 与 `C` 合并。
 */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '');
}

/** type / relation 字段统一为 `UPPER_SNAKE`（提示词要求英文）；非 ASCII 或空值回退给定缺省 */
export function normalizeKgLabel(raw: string, fallback: string): string {
  const label = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, KG_MAX_LABEL_CHARS);
  return label || fallback;
}
