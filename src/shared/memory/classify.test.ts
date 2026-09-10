import { describe, expect, it } from 'vitest';
import { parseClassification } from './classify';

describe('parseClassification', () => {
  it('strips and parses tags', () => {
    const raw = '已记下。\n\n[TYPE: capture]\n[UNIT_TYPE: decision]\n[TITLE: 选用 PostgreSQL]';
    const p = parseClassification(raw);
    expect(p.inputType).toBe('capture');
    expect(p.unitType).toBe('decision');
    expect(p.unitTypeSource).toBe('explicit');
    expect(p.title).toBe('选用 PostgreSQL');
    expect(p.cleanText).toBe('已记下。');
    expect(p.cleanText).not.toContain('[TYPE');
  });

  it('accepts full-width colon', () => {
    const p = parseClassification(
      '好的。\n[TYPE：capture]\n[UNIT_TYPE：preference]\n[TITLE：偏好深色主题]'
    );
    expect(p.inputType).toBe('capture');
    expect(p.unitType).toBe('preference');
    expect(p.title).toBe('偏好深色主题');
    expect(p.cleanText).toBe('好的。');
  });

  it('is case-insensitive on tag names and values', () => {
    const p = parseClassification('x\n[type: Capture]\n[unit_type: DECISION]\n[title: T]');
    expect(p.inputType).toBe('capture');
    expect(p.unitType).toBe('decision');
  });

  it('falls back to fact for unknown unit_type with source=fallback', () => {
    const p = parseClassification('x\n[TYPE: capture]\n[UNIT_TYPE: crystal]\n[TITLE: t]');
    expect(p.unitType).toBe('fact');
    expect(p.unitTypeSource).toBe('fallback');
    expect(p.cleanText).toBe('x');
  });

  it('maps null unit_type / title to null', () => {
    const p = parseClassification('这是回答。\n[TYPE: question]\n[UNIT_TYPE: null]\n[TITLE: null]');
    expect(p.inputType).toBe('question');
    expect(p.unitType).toBeNull();
    expect(p.unitTypeSource).toBe('explicit');
    expect(p.title).toBeNull();
    expect(p.cleanText).toBe('这是回答。');
  });

  it('uses default fact when no unit_type tag present', () => {
    const p = parseClassification('纯文本，没有标签');
    expect(p.inputType).toBeNull();
    expect(p.unitType).toBe('fact');
    expect(p.unitTypeSource).toBe('default');
    expect(p.title).toBeNull();
    expect(p.cleanText).toBe('纯文本，没有标签');
  });

  it('treats empty title as null', () => {
    const p = parseClassification('x\n[TYPE: capture]\n[TITLE:   ]');
    expect(p.title).toBeNull();
  });

  it('extracts tags inside a code fence and drops the emptied fence', () => {
    const raw = '已记下。\n\n```\n[TYPE: capture]\n[UNIT_TYPE: learning]\n[TITLE: 踩坑]\n```';
    const p = parseClassification(raw);
    expect(p.inputType).toBe('capture');
    expect(p.unitType).toBe('learning');
    expect(p.title).toBe('踩坑');
    expect(p.cleanText).toBe('已记下。');
  });

  it('keeps tags outside a fence parseable when a fence has other content', () => {
    const raw =
      '看这段：\n```ts\nconst a = 1;\n```\n[TYPE: capture]\n[UNIT_TYPE: procedure]\n[TITLE: 示例]';
    const p = parseClassification(raw);
    expect(p.unitType).toBe('procedure');
    expect(p.cleanText).toBe('看这段：\n```ts\nconst a = 1;\n```');
  });

  it('takes the last occurrence for duplicated tags', () => {
    const raw =
      '[TYPE: question]\n[UNIT_TYPE: fact]\n[TITLE: 旧]\n正文\n[TYPE: capture]\n[UNIT_TYPE: plan]\n[TITLE: 新]';
    const p = parseClassification(raw);
    expect(p.inputType).toBe('capture');
    expect(p.unitType).toBe('plan');
    expect(p.title).toBe('新');
    expect(p.cleanText).toBe('正文');
  });

  it('ignores unknown TYPE values but still strips the tag', () => {
    const p = parseClassification('x\n[TYPE: banana]');
    expect(p.inputType).toBeNull();
    expect(p.cleanText).toBe('x');
  });
});
