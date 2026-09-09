import { describe, expect, it } from 'vitest';
import {
  AUTO_ARCHIVE_IDLE_DAYS,
  AUTO_DELETE_ARCHIVED_DAYS,
  DEFAULT_AUTO_ARCHIVE_IDLE_DAYS,
  DEFAULT_AUTO_DELETE_ARCHIVED_DAYS,
  normalizeAutoArchiveIdleDays,
  normalizeAutoDeleteArchivedDays,
} from './autoArchiveIdleDays';

describe('auto archive idle days', () => {
  it('暴露允许值与默认 30 天', () => {
    expect(AUTO_ARCHIVE_IDLE_DAYS).toEqual([0, 7, 14, 30, 90]);
    expect(DEFAULT_AUTO_ARCHIVE_IDLE_DAYS).toBe(30);
  });

  it('保留允许值', () => {
    expect(AUTO_ARCHIVE_IDLE_DAYS.map((value) => normalizeAutoArchiveIdleDays(value))).toEqual(
      AUTO_ARCHIVE_IDLE_DAYS
    );
  });

  it('非法值回落到 30 天', () => {
    expect(
      [undefined, null, 15, -1, '30', 7.5].map((value) => normalizeAutoArchiveIdleDays(value))
    ).toEqual([30, 30, 30, 30, 30, 30]);
  });
});

describe('auto delete archived days', () => {
  it('暴露允许值且默认关闭', () => {
    expect(AUTO_DELETE_ARCHIVED_DAYS).toEqual([0, 7, 15, 30, 90]);
    expect(DEFAULT_AUTO_DELETE_ARCHIVED_DAYS).toBe(0);
  });

  it('保留允许值', () => {
    expect(
      AUTO_DELETE_ARCHIVED_DAYS.map((value) => normalizeAutoDeleteArchivedDays(value))
    ).toEqual(AUTO_DELETE_ARCHIVED_DAYS);
  });

  it('非法值安全回落到关闭而非 30 天', () => {
    expect(
      [undefined, null, 14, -1, '30', 7.5].map((value) => normalizeAutoDeleteArchivedDays(value))
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
