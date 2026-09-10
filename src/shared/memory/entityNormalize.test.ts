import { describe, expect, it } from 'vitest';
import { normalizeEntityName, normalizeKgLabel } from './entityNormalize';

describe('normalizeEntityName', () => {
  it('大小写 / 空白 / 连字符 / 下划线差异折叠为同一键', () => {
    const key = normalizeEntityName('PostgreSQL');
    for (const v of ['postgresql', ' Postgre SQL ', 'postgre-sql', 'Postgre_SQL', 'POSTGRESQL\n']) {
      expect(normalizeEntityName(v)).toBe(key);
    }
  });

  it('NFC 归一：组合字符与预组字符相同', () => {
    expect(normalizeEntityName('Caf\u0065\u0301')).toBe(normalizeEntityName('Caf\u00e9'));
  });

  it('中文不做额外处理，只去空白', () => {
    expect(normalizeEntityName('读写 分离')).toBe('读写分离');
    expect(normalizeEntityName('读写分离')).not.toBe(normalizeEntityName('主从复制'));
  });

  it('空 / 纯空白返回空串', () => {
    expect(normalizeEntityName('   ')).toBe('');
    expect(normalizeEntityName('- _ -')).toBe('');
  });
});

describe('normalizeKgLabel', () => {
  it('英文标签统一大写下划线；空值回退', () => {
    expect(normalizeKgLabel('software tool', 'CONCEPT')).toBe('SOFTWARE_TOOL');
    expect(normalizeKgLabel('works-with', 'RELATED_TO')).toBe('WORKS_WITH');
    expect(normalizeKgLabel('   ', 'CONCEPT')).toBe('CONCEPT');
    expect(normalizeKgLabel('数据库', 'CONCEPT')).toBe('CONCEPT');
  });

  it('超长标签截断', () => {
    expect(normalizeKgLabel('a'.repeat(200), 'X').length).toBeLessThanOrEqual(40);
  });
});
