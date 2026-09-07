import fs from 'node:fs';
import path from 'node:path';
import type { ExternalSession, SimpleMessage } from '@shared/types/sessionImport';

const MAX_FILES = 2000;
const MAX_DEPTH = 4;

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part && typeof part === 'object' && (part as { type?: string }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : ''
    )
    .join('');
}

function listJsonlFiles(sessionsDir: string): { path: string; mtime: number }[] {
  const results: { path: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || results.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.jsonl')) {
        try {
          results.push({ path: full, mtime: fs.statSync(full).mtimeMs });
        } catch {}
      }
    }
  };
  walk(sessionsDir, 0);
  return results.sort((a, b) => b.mtime - a.mtime);
}

function cwdOfSession(filePath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (entry?.type === 'session' && typeof entry.cwd === 'string') return entry.cwd;
  }
  return null;
}

/** 解析 pi / oh-my-pi 的 v3 jsonl 为拉平消息（不原样复制，避免带入 tool） */
export function readPiV3Session(filePath: string): { title: string; messages: SimpleMessage[] } {
  const messages: SimpleMessage[] = [];
  let titled = '';
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { title: '', messages: [] };
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.type === 'title' && typeof entry.title === 'string' && entry.title.trim()) {
      titled = entry.title.trim();
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const text = textOfContent(message.content).trim();
    if (!text) continue;
    const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : undefined;
    messages.push({
      role: message.role,
      text,
      timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
    });
  }
  const title = titled || messages.find((m) => m.role === 'user')?.text.slice(0, 40) || '';
  return { title, messages };
}

function listPiV3Sessions(sessionsDir: string, projectPath: string): ExternalSession[] {
  const sessions: ExternalSession[] = [];
  for (const file of listJsonlFiles(sessionsDir)) {
    if (cwdOfSession(file.path) !== projectPath) continue;
    const { title, messages } = readPiV3Session(file.path);
    if (messages.length === 0) continue;
    sessions.push({
      path: file.path,
      title,
      updatedAt: file.mtime,
      messageCount: messages.length,
    });
  }
  return sessions;
}

/** 列出 ~/.pi/agent/sessions 下 cwd 匹配的会话 */
export function listPiSessions(
  projectPath: string,
  home = process.env.HOME ?? ''
): ExternalSession[] {
  return listPiV3Sessions(path.join(home, '.pi', 'agent', 'sessions'), projectPath);
}

/** 列出 ~/.omp/agent/sessions 下 cwd 匹配的会话 */
export function listOhMyPiSessions(
  projectPath: string,
  home = process.env.HOME ?? ''
): ExternalSession[] {
  return listPiV3Sessions(path.join(home, '.omp', 'agent', 'sessions'), projectPath);
}
