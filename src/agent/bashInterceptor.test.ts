import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { checkBashInterception, withBashInterception } from './bashInterceptor';

const tools = ['read', 'grep', 'edit', 'write', 'find'];

describe('checkBashInterception', () => {
  it('blocks cat / head / Get-Content and points at read', () => {
    for (const command of [
      'cat src/a.ts',
      'head -n 20 src/a.ts',
      'Get-Content src/a.ts',
      'gc src/a.ts',
    ]) {
      const result = checkBashInterception(command, tools);
      expect(result.block, command).toBe(true);
      expect(result.suggestedTool).toBe('read');
    }
  });

  it('blocks grep / rg / Select-String and points at grep', () => {
    for (const command of [
      'grep -n foo src',
      'rg foo src',
      'Select-String -Path src -Pattern foo',
      'sls foo',
    ]) {
      const result = checkBashInterception(command, tools);
      expect(result.block, command).toBe(true);
      expect(result.suggestedTool).toBe('grep');
    }
  });

  it('blocks in-place sed / perl / Set-Content and points at edit', () => {
    for (const command of [
      "sed -i 's/a/b/' file.ts",
      'perl -pi -e s/a/b/ file.ts',
      'Set-Content -Path file.ts -Value x',
    ]) {
      const result = checkBashInterception(command, tools);
      expect(result.block, command).toBe(true);
      expect(result.suggestedTool).toBe('edit');
    }
  });

  it('blocks later stages after && / ; but not a piped stdin consumer', () => {
    expect(checkBashInterception('echo hi && cat file.ts', tools).block).toBe(true);
    expect(checkBashInterception('printf x | cat', tools).block).toBe(false);
    expect(checkBashInterception('git show HEAD:file.ts', tools).block).toBe(false);
  });

  it('does not block when the suggested tool is unavailable', () => {
    expect(checkBashInterception('cat file.ts', ['bash']).block).toBe(false);
  });

  it('blocks cat writes and points at write, not read', () => {
    for (const command of [
      "cat >> src/agent/memory/pipeline.test.ts <<'EOF'",
      'cat > /tmp/out.txt <<EOF',
      'cat >> file.ts',
    ]) {
      const result = checkBashInterception(command, tools);
      expect(result.block, command).toBe(true);
      expect(result.suggestedTool, command).toBe('write');
      expect(result.message, command).toMatch(/write/);
      expect(result.message, command).not.toMatch(/`read`/);
    }
  });

  it('still treats cat file reads as read, including 2>&1', () => {
    expect(checkBashInterception('cat src/a.ts', tools).suggestedTool).toBe('read');
    expect(checkBashInterception('cat src/a.ts 2>&1', tools).suggestedTool).toBe('read');
  });
});

function bashTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'bash',
    label: 'Bash',
    description: 'Run a shell command.',
    parameters: { type: 'object' },
    execute: async () => ({ content: [], details: {} }),
    ...overrides,
  } as unknown as ToolDefinition;
}

describe('withBashInterception description', () => {
  it('appends a prefer-read hint so the model sees it before calling bash', () => {
    const wrapped = withBashInterception(bashTool());
    expect(wrapped.description).toContain('Do not use cat/head/tail/less/more/grep/rg');
    expect(wrapped.description).toContain('Do not use cat >/>> or heredocs');
    expect(wrapped.description).toContain(
      'Use the `read`, `grep`, `edit`, `write`, or `find` tools'
    );
    expect(wrapped.description).toContain('Run a shell command.');
  });
});

describe('withBashInterception promptGuidelines', () => {
  it('把拦截禁令写进 Guidelines，点名改用 read/grep/edit/write/find', () => {
    const wrapped = withBashInterception(bashTool());
    const text = (wrapped.promptGuidelines ?? []).join('\n');
    expect(text).toContain('Do not use cat/head/tail/less/more/grep/rg');
    expect(text).toContain('Do not use cat >/>> or heredocs');
    expect(text).toContain('Use the `read`, `grep`, `edit`, `write`, or `find` tools');
  });

  it('追加拦截禁令，不覆盖工具原有 promptGuidelines', () => {
    const wrapped = withBashInterception(
      bashTool({
        promptGuidelines: [
          'You can inspect PI_* environment variables for current model and session details.',
        ],
      })
    );
    expect(wrapped.promptGuidelines).toContain(
      'You can inspect PI_* environment variables for current model and session details.'
    );
    expect(wrapped.promptGuidelines?.join('\n')).toContain(
      'Use the `read`, `grep`, `edit`, `write`, or `find` tools'
    );
  });
});
