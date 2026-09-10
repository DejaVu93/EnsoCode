import { createHash } from 'node:crypto';

/**
 * 精确去重的第一道闸（向量候选网之前的零成本检查）。
 * 规范化：NFC、去首尾空白、连续空白折叠为一个空格。**不**折叠大小写：记忆正文常含代码标识符 /
 * 环境变量 / 路径（`Postgres` 与 `POSTGRES` 可能指不同事物），大小写差异视为不同内容，交给向量候选网判相似。
 */
export function normalizeContent(content: string): string {
  return content.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function contentHash(content: string): string {
  return createHash('sha256').update(normalizeContent(content)).digest('hex');
}
