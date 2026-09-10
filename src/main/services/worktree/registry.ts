/**
 * 会话 ↔ worktree 绑定的持久化注册表（main 权威）。
 * spawn cwd 授权（ipc/agent.ts persistedRootSpawn）依赖此表判断 worktree 路径合法性。
 * 单文件 JSON（userData/worktrees.json），量小，同步读写 + 内存缓存。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionWorktree } from '../../../shared/types/worktree';

export class WorktreeRegistry {
  private records = new Map<string, SessionWorktree>();

  constructor(private readonly filePath: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          const r = value as SessionWorktree;
          if (r && typeof r.path === 'string' && typeof r.branch === 'string') {
            const name = typeof r.name === 'string' ? r.name.trim() : '';
            this.records.set(id, { ...r, name: name && name.length <= 80 ? name : undefined });
          }
        }
      }
    } catch {
      // 文件不存在或损坏：当空库
    }
  }

  get(conversationId: string): SessionWorktree | undefined {
    return this.records.get(conversationId);
  }

  set(record: SessionWorktree): void {
    this.records.set(record.conversationId, record);
    this.flush();
  }

  share(fromConversationId: string, toConversationId: string): void {
    const source = this.records.get(fromConversationId);
    if (!source) return;
    const previous = this.records.get(toConversationId);
    this.records.set(toConversationId, { ...source, conversationId: toConversationId });
    try {
      this.flush();
    } catch (error) {
      if (previous) this.records.set(toConversationId, previous);
      else this.records.delete(toConversationId);
      throw error;
    }
  }

  bindings(record: SessionWorktree): SessionWorktree[] {
    return this.list(record.projectId).filter(
      (candidate) => candidate.repoPath === record.repoPath && candidate.path === record.path
    );
  }

  replaceBindings(previous: SessionWorktree, replacement: SessionWorktree): SessionWorktree[] {
    const bindings = this.bindings(previous);
    const updated = bindings.map((record) => ({
      ...replacement,
      conversationId: record.conversationId,
    }));
    for (const record of updated) this.records.set(record.conversationId, record);
    try {
      this.flush();
    } catch (error) {
      for (const record of bindings) this.records.set(record.conversationId, record);
      throw error;
    }
    return updated;
  }

  rename(conversationId: string, value: string): SessionWorktree[] {
    const record = this.get(conversationId);
    if (!record) throw new Error('no worktree for conversation');
    const name = value.trim();
    if (name.length > 80) throw new Error('worktree name must be at most 80 characters');
    return this.replaceBindings(record, { ...record, name: name || undefined });
  }

  delete(conversationId: string): void {
    const previous = this.records.get(conversationId);
    if (!previous) return;
    this.records.delete(conversationId);
    try {
      this.flush();
    } catch (error) {
      this.records.set(conversationId, previous);
      throw error;
    }
  }

  list(projectId?: string): SessionWorktree[] {
    const all = [...this.records.values()];
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.records), null, 2));
  }
}
