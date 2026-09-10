export const DEFAULT_MAX_ACTIVE_COWORKERS = 5;
export const MIN_MAX_ACTIVE_COWORKERS = 1;
export const MAX_MAX_ACTIVE_COWORKERS = 20;

export function normalizeMaxActiveCoworkers(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_MAX_ACTIVE_COWORKERS;
  if (value < MIN_MAX_ACTIVE_COWORKERS) return MIN_MAX_ACTIVE_COWORKERS;
  if (value > MAX_MAX_ACTIVE_COWORKERS) return MAX_MAX_ACTIVE_COWORKERS;
  return value;
}

export function parseMaxActiveCoworkers(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_MAX_ACTIVE_COWORKERS || value > MAX_MAX_ACTIVE_COWORKERS) return null;
  return value;
}
