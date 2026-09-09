import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const MAX_RESOURCE_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 4096;

export interface PortableSkillFile {
  path: string;
  content: string;
  executable?: boolean;
}

export interface PortableSkillResource {
  id: string;
  files: PortableSkillFile[];
}

export interface PortableInstructionResource {
  id: string;
  content: string;
}

/** 仅做字符集与长度形状检查；规范性由调用方 decode→encode 回环保证。避免分组重复正则在数 MB 输入上栈溢出。 */
export function hasBase64Shape(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value);
}

function inside(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error('Invalid resource path');
  }
  return normalized;
}

interface WalkState {
  files: number;
  bytes: number;
}

function collectFiles(root: string): PortableSkillFile[] {
  const state: WalkState = { files: 0, bytes: 0 };
  const files: PortableSkillFile[] = [];
  const seen = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Unsupported resource link');
      const rel = safeRelativePath(relative(root, full));
      const key = rel.toLocaleLowerCase();
      if (seen.has(key)) throw new Error('Duplicate resource path');
      seen.add(key);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) throw new Error('Unsupported resource file');
      if (stat.size > MAX_FILE_BYTES || state.bytes + stat.size > MAX_RESOURCE_BYTES) {
        throw new Error('Resource size limit exceeded');
      }
      state.files += 1;
      if (state.files > MAX_FILES) throw new Error('Resource file limit exceeded');
      state.bytes += stat.size;
      files.push({
        path: rel,
        content: readFileSync(full).toString('base64'),
        ...(stat.mode & 0o111 ? { executable: true } : {}),
      });
    }
  };
  walk(root);
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('Skill is missing SKILL.md');
  }
  return files;
}

export function collectSkillResource(id: string, root: string): PortableSkillResource {
  if (!id) throw new Error('Invalid skill resource');
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid skill resource');
  return { id, files: collectFiles(root) };
}

export function stageResources(
  root: string,
  skills: PortableSkillResource[],
  instructions: PortableInstructionResource[]
): { batchRoot: string; skillPaths: Map<string, string>; instructionPaths: Map<string, string> } {
  const batchRoot = join(root, 'config-imports', randomUUID());
  const skillPaths = new Map<string, string>();
  const instructionPaths = new Map<string, string>();
  try {
    let totalFiles = 0;
    let totalBytes = 0;
    mkdirSync(batchRoot, { recursive: true, mode: 0o700 });
    for (const skill of skills) {
      const skillRoot = join(batchRoot, 'skills', randomUUID());
      mkdirSync(skillRoot, { recursive: true, mode: 0o700 });
      for (const file of skill.files) {
        const rel = safeRelativePath(file.path);
        const target = join(skillRoot, ...rel.split('/'));
        if (!inside(skillRoot, target)) throw new Error('Invalid resource path');
        mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
        if (!hasBase64Shape(file.content)) throw new Error('Invalid resource content');
        const bytes = Buffer.from(file.content, 'base64');
        if (bytes.toString('base64') !== file.content || bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error('Invalid resource content');
        }
        totalFiles += 1;
        totalBytes += bytes.byteLength;
        if (totalFiles > MAX_FILES || totalBytes > MAX_RESOURCE_BYTES) {
          throw new Error('Resource size limit exceeded');
        }
        writeFileSync(target, bytes, { mode: file.executable ? 0o700 : 0o600, flag: 'wx' });
        chmodSync(target, file.executable ? 0o700 : 0o600);
      }
      skillPaths.set(skill.id, skillRoot);
    }
    for (const instruction of instructions) {
      const bytes = Buffer.byteLength(instruction.content, 'utf8');
      totalFiles += 1;
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES || totalFiles > MAX_FILES || totalBytes > MAX_RESOURCE_BYTES) {
        throw new Error('Resource size limit exceeded');
      }
      const file = join(batchRoot, 'instructions', `${randomUUID()}.md`);
      mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(file, instruction.content, { mode: 0o600, flag: 'wx' });
      instructionPaths.set(instruction.id, file);
    }
    return { batchRoot, skillPaths, instructionPaths };
  } catch (error) {
    rmSync(batchRoot, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupStagedResources(paths: Iterable<string>): void {
  const roots = new Set<string>();
  for (const value of paths) roots.add(value);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
