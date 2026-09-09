export const AUTO_ARCHIVE_IDLE_DAYS = [0, 7, 14, 30, 90] as const;
export type AutoArchiveIdleDays = (typeof AUTO_ARCHIVE_IDLE_DAYS)[number];
export const DEFAULT_AUTO_ARCHIVE_IDLE_DAYS: AutoArchiveIdleDays = 30;

export const AUTO_DELETE_ARCHIVED_DAYS = [0, 7, 15, 30, 90] as const;
export type AutoDeleteArchivedDays = (typeof AUTO_DELETE_ARCHIVED_DAYS)[number];
export const DEFAULT_AUTO_DELETE_ARCHIVED_DAYS: AutoDeleteArchivedDays = 0;

function isAllowed<T extends number>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'number' && Number.isInteger(value) && allowed.includes(value as T);
}

export function normalizeAutoArchiveIdleDays(value: unknown): AutoArchiveIdleDays {
  return isAllowed(value, AUTO_ARCHIVE_IDLE_DAYS) ? value : DEFAULT_AUTO_ARCHIVE_IDLE_DAYS;
}

export function normalizeAutoDeleteArchivedDays(value: unknown): AutoDeleteArchivedDays {
  return isAllowed(value, AUTO_DELETE_ARCHIVED_DAYS) ? value : DEFAULT_AUTO_DELETE_ARCHIVED_DAYS;
}
