export interface AppCloseDecision {
  allow: boolean;
}

export function shouldBypassCloseConfirm(input: {
  allowQuit: boolean;
  quittingForUpdate: boolean;
}): boolean {
  return input.allowQuit || input.quittingForUpdate;
}

export function parseAppCloseResponse(
  requestId: string,
  incomingId: unknown,
  payload: unknown
): AppCloseDecision | null {
  if (typeof incomingId !== 'string' || incomingId !== requestId) return null;
  if (!payload || typeof payload !== 'object') return null;
  const confirmed = (payload as { confirmed?: unknown }).confirmed;
  if (typeof confirmed !== 'boolean') return null;
  return { allow: confirmed };
}
