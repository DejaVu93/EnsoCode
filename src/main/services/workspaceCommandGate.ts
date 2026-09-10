import type { AgentCommand } from '@shared/types/agent';

export function workspaceCommandBlocked(
  command: AgentCommand,
  isBusy: (id: string) => boolean
): boolean {
  switch (command.type) {
    case 'spawn-parent':
    case 'spawn-child':
    case 'prompt':
    case 'prompt-child':
    case 'steer':
    case 'retry':
    case 'rewind':
    case 'compact':
    case 'fork':
      return isBusy(
        'parent' in command.identity
          ? command.identity.parent.sessionId
          : command.identity.sessionId
      );
    case 'resume-coworker':
      return isBusy(command.parent.sessionId);
    default:
      return false;
  }
}
