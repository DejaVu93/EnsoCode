// trigram tokenizer 对 <3 字符的 MATCH 恒为空（SQLite 文档），短 token 走 LIKE
const TRIGRAM_MIN_CHARS = 3;
// FTS5 查询语法字符；用户输入按字面处理，全部当分隔符
const FTS_SYNTAX_RE = /["*()^:{}]+/;

export function buildFtsMatchQuery(q: string): { match: string; short: string[] } {
  const long: string[] = [];
  const short: string[] = [];
  for (const raw of q.split(/\s+/).flatMap((t) => t.split(FTS_SYNTAX_RE))) {
    const token = raw.trim();
    if (!token) continue;
    if (Array.from(token).length >= TRIGRAM_MIN_CHARS) long.push(`"${token.replace(/"/g, '""')}"`);
    else short.push(token);
  }
  return { match: long.join(' OR '), short };
}
