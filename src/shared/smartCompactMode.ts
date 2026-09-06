export const SMART_COMPACT_MODES = ['auto', 'fast', 'balanced', 'thorough'] as const;

export type SmartCompactMode = (typeof SMART_COMPACT_MODES)[number];

export function parseSmartCompactMode(value: unknown): SmartCompactMode | null {
  return typeof value === 'string' && (SMART_COMPACT_MODES as readonly string[]).includes(value)
    ? (value as SmartCompactMode)
    : null;
}
