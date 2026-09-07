const HASHLINE_HEADER = /^\[.+#[0-9A-Fa-f]{4}\]$/;

/** 剥掉 Hashline read 输出的 `[path#TAG]` 头与 `N:` 行号 gutter；非 Hashline 文本原样返回 */
export function stripHashlineRead(text: string): string {
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  if (!HASHLINE_HEADER.test(head)) return text;
  if (nl === -1) return '';
  return text
    .slice(nl + 1)
    .split('\n')
    .map((line) => line.replace(/^\d+:/, ''))
    .join('\n');
}
