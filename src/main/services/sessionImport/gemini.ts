import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExternalSession, SimpleMessage } from '@shared/types/sessionImport';

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
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

function messagesFromEntries(entries: unknown[]): SimpleMessage[] {
  const messages: SimpleMessage[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const text = textOfContent(entry.content).trim();
    if (!text) continue;
    messages.push({ role: entry.type, text });
  }
  return messages;
}

function isWholeJson(filePath: string, content: string): Record<string, unknown> | null {
  if (filePath.endsWith('.jsonl')) return null;
  const obj = parseLine(content.trim());
  if (!obj) return null;
  if (
    Array.isArray(obj.messages) ||
    typeof obj.kind === 'string' ||
    typeof obj.sessionId === 'string'
  ) {
    return obj;
  }
  return null;
}

function kindOf(filePath: string, content: string): string {
  const whole = isWholeJson(filePath, content);
  if (typeof whole?.kind === 'string') return whole.kind;
  for (const line of content.split('\n')) {
    const entry = parseLine(line);
    if (typeof entry?.kind === 'string') return entry.kind;
  }
  return '';
}

/** 解析 Gemini CLI session 文件（jsonl 或整文件 JSON） */
export function readGeminiSession(filePath: string): { title: string; messages: SimpleMessage[] } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { title: '', messages: [] };
  }
  const whole = isWholeJson(filePath, content);
  let firstUserMessage = '';
  let messages: SimpleMessage[] = [];
  if (whole) {
    if (typeof whole.firstUserMessage === 'string') firstUserMessage = whole.firstUserMessage;
    messages = messagesFromEntries(Array.isArray(whole.messages) ? whole.messages : []);
  } else {
    const entries: unknown[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const entry = parseLine(line);
      if (entry) entries.push(entry);
    }
    messages = messagesFromEntries(entries);
  }
  const title =
    firstUserMessage || messages.find((m) => m.role === 'user')?.text.slice(0, 40) || '';
  return { title, messages };
}

function projectSlug(home: string, projectPath: string): string | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(home, '.gemini', 'projects.json'), 'utf-8')
    ) as {
      projects?: Record<string, unknown>;
    };
    const slug = raw.projects?.[projectPath];
    return typeof slug === 'string' && slug ? slug : null;
  } catch {
    return null;
  }
}

function listSessionFiles(home: string, identifier: string): string[] {
  const dir = path.join(home, '.gemini', 'tmp', identifier, 'chats');
  try {
    return fs
      .readdirSync(dir)
      .filter(
        (name) => name.startsWith('session-') && (name.endsWith('.jsonl') || name.endsWith('.json'))
      )
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function isSubagent(filePath: string): boolean {
  try {
    return kindOf(filePath, fs.readFileSync(filePath, 'utf-8')) === 'subagent';
  } catch {
    return false;
  }
}

/** 列出 Gemini CLI 在某项目下的会话（同时认 slug 与 sha256） */
export function listGeminiSessions(
  projectPath: string,
  home = process.env.HOME ?? ''
): ExternalSession[] {
  const ids = new Set<string>();
  const slug = projectSlug(home, projectPath);
  if (slug) ids.add(slug);
  ids.add(createHash('sha256').update(projectPath).digest('hex'));
  const seen = new Set<string>();
  const sessions: ExternalSession[] = [];
  for (const id of ids) {
    for (const filePath of listSessionFiles(home, id)) {
      if (seen.has(filePath) || isSubagent(filePath)) continue;
      seen.add(filePath);
      const { title, messages } = readGeminiSession(filePath);
      if (messages.length === 0) continue;
      let updatedAt = 0;
      try {
        updatedAt = fs.statSync(filePath).mtimeMs;
      } catch {}
      sessions.push({ path: filePath, title, updatedAt, messageCount: messages.length });
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}
