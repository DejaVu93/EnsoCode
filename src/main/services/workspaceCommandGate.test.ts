import type { AgentCommand } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { workspaceCommandBlocked } from './workspaceCommandGate';

const identity = { sessionId: 'root', generation: 'generation' };
describe('workspace command gate', () => {
  it.each([
    'spawn-parent',
    'spawn-child',
    'prompt',
    'prompt-child',
    'steer',
    'retry',
    'rewind',
    'compact',
    'fork',
  ])('blocks %s before worker delivery or queueing', (type) => {
    const command = { type, identity } as AgentCommand;
    expect(workspaceCommandBlocked(command, (id) => id === 'root')).toBe(true);
    expect(workspaceCommandBlocked(command, () => false)).toBe(false);
  });
  it('resolves resume-coworker using its parent, not renderer paths', () => {
    expect(
      workspaceCommandBlocked(
        {
          type: 'resume-coworker',
          parent: identity,
          coworkerId: 'child',
          name: 'Child',
          resumeFile: '/s',
        },
        (id) => id === 'root'
      )
    ).toBe(true);
  });
  it('keeps abort, snapshot and result acknowledgements available', () => {
    for (const command of [
      { type: 'abort', identity },
      { type: 'snapshot' },
      { type: 'release-parent', identity },
    ] as AgentCommand[])
      expect(workspaceCommandBlocked(command, () => true)).toBe(false);
  });
});
