/** cyrb53：够快够散的 53 位字符串哈希，非加密用途。 */
function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * @pierre/diffs 的 worker 池按 `fileDiff.cacheKey` 缓存高亮结果，而 parseDiffFromFile 默认
 * 只用文件名当 key——同一路径内容一变就命中旧结果，行数对不上直接抛
 * "deletionLine and additionLine are null"。这里把内容也算进 key。
 */
export function diffCacheKey(name: string, oldText: string, newText: string): string {
  return `${name}:${hash53(oldText)}:${hash53(newText, 1)}`;
}
