import path from 'node:path';

/**
 * SDK 在 Windows 上会把 POSIX 绝对路径解析成本地盘符根路径
 * (`/Users/...` → `C:\Users\...`)。远端主机始终按 POSIX 处理。
 */
export function toPosixRemotePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const drive = /^[A-Za-z]:(\/.*)?$/.exec(normalized);
  if (drive) return path.posix.normalize(drive[1] && drive[1].length > 0 ? drive[1] : '/');
  return normalized.startsWith('/') ? path.posix.normalize(normalized) : normalized;
}

export function resolvePosixRemotePath(cwd: string, filePath: string): string {
  const target = toPosixRemotePath(filePath);
  const base = toPosixRemotePath(cwd);
  return path.posix.isAbsolute(target)
    ? path.posix.normalize(target)
    : path.posix.resolve(base, target);
}

export function relativizePosixRemotePath(absolutePath: string, root: string): string {
  const posix = toPosixRemotePath(absolutePath);
  const base = toPosixRemotePath(root);
  if (posix === base) return '.';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return posix.startsWith(prefix) ? posix.slice(prefix.length) : posix;
}
