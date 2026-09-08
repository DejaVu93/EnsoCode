/** 绝对路径判定：posix `/`、Windows 盘符 `C:\` / `C:/`、UNC `\\server\share`。不碰文件系统。 */
export function isAbsolutePathLike(value: string): boolean {
  return /^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

/** 非字符串 / 空白 / 非绝对路径一律回落 fallback，否则返回 trim 后的值。 */
export function resolveWorktreeRoot(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || !isAbsolutePathLike(trimmed)) return fallback;
  return trimmed;
}
