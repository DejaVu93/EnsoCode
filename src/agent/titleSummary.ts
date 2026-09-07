/** 会话标题总结：一次性补全的输入与输出处理（纯函数，供 supervisor 调用）。 */

import type { ProjectedMessage, TitleSummaryInput, TurnDigest } from '@shared/types/agent';

/** 送给模型的用户消息上限：标题只需要开头，长指令全文只会烧 token */
const MAX_INPUT_CHARS = 2000;

/** 滚动摘要：本轮 user 文本截头上限 */
export const TURN_DIGEST_USER_MAX = 2000;
/** 滚动摘要：本轮 assistant 结论截尾上限（结论通常在末尾） */
export const TURN_DIGEST_ASSISTANT_MAX = 1500;

/** 标题上限，与 renameConversation 的 slice(0, 80) 对齐 */
const MAX_TITLE_CHARS = 80;

export const TITLE_SYSTEM_PROMPT = [
  'You generate a short title for a coding conversation based on the user message.',
  'Rules:',
  '- Reply with the title text only: no quotes, no trailing punctuation, no explanations.',
  '- Keep it under 20 characters for CJK languages, or about 6 words for English.',
].join('\n');

export const ROLLING_TITLE_SYSTEM_PROMPT = [
  'You maintain the title of an ongoing coding conversation.',
  'You are given the current title plus the latest user request and the latest assistant conclusion.',
  'Rules:',
  '- The title must summarize the topic of the WHOLE conversation, not only the latest turn.',
  '- If the current title is still accurate, reply with the current title verbatim.',
  '- Only change the title when the conversation topic has clearly shifted or become more specific.',
  '- Reply with the title text only: no quotes, no trailing punctuation, no explanations.',
  '- Keep it under 20 characters for CJK languages, or about 6 words for English.',
  '- Write the title in the same language as the user messages.',
].join('\n');

const INLINE_CHAT_REF =
  /\[Referenced past chat "(.+?)" — transcript file: (.+?) \(pi session jsonl; read it if relevant\)\]/g;
const INLINE_UI_REF = /\[Selected UI element "([^"]*)" — path: (.*?); text: (.*?)\]/g;
const CONTINUATION_LINE = /^(?:从这里继续|继续|continue(?:\s+here)?)\s*[:：]?\s*$/i;

export function buildTitleUserText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const chatLabels: string[] = [];
  for (const match of trimmed.matchAll(INLINE_CHAT_REF)) {
    if (match[1]?.trim()) chatLabels.push(match[1].trim());
  }

  const stripped = trimmed.replace(INLINE_CHAT_REF, '').replace(INLINE_UI_REF, '');

  const lines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  while (lines.length > 1 && CONTINUATION_LINE.test(lines[0])) {
    lines.shift();
  }
  const cleanBody = lines.join('\n').trim();

  if (cleanBody && !CONTINUATION_LINE.test(cleanBody)) {
    return cleanBody.slice(0, MAX_INPUT_CHARS);
  }

  if (chatLabels.length > 0) {
    return chatLabels[0].slice(0, MAX_INPUT_CHARS);
  }

  return cleanBody.slice(0, MAX_INPUT_CHARS);
}

const orNone = (text: string): string => (text.trim() ? text.trim() : '(none)');

/** 滚动模式送给模型的 user text：三段结构，空段用 (none) 占位 */
export function buildRollingTitleUserText(
  input: Extract<TitleSummaryInput, { kind: 'rolling' }>
): string {
  return [
    `Current title: ${orNone(input.currentTitle)}`,
    '',
    'Latest user request:',
    orNone(input.userText),
    '',
    'Latest assistant conclusion:',
    orNone(input.assistantText),
  ].join('\n');
}

function textOf(message: ProjectedMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

/**
 * 从投影消息里切出本轮摘要：user 段取切片内全部 user 文本（清洗后拼接、截头），
 * assistant 段取切片内最后一条含 text 且非 error/aborted 的 assistant（截尾）。
 * 切片内无 user 时回退到全量里最近一条 user；两段皆空返回 null。
 */
export function buildTurnDigest(
  messages: ProjectedMessage[],
  fromIndex: number
): TurnDigest | null {
  const start = Math.max(0, Math.min(fromIndex, messages.length));
  const turn = messages.slice(start);

  let userParts = turn
    .filter((message) => message.role === 'user')
    .map((message) => buildTitleUserText(textOf(message)))
    .filter((text) => text.length > 0);
  if (userParts.length === 0) {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const fallback = lastUser ? buildTitleUserText(textOf(lastUser)) : '';
    userParts = fallback ? [fallback] : [];
  }
  const userText = userParts.join('\n').slice(0, TURN_DIGEST_USER_MAX);

  const conclusion = [...turn]
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        message.stopReason !== 'error' &&
        message.stopReason !== 'aborted' &&
        textOf(message).length > 0
    );
  const assistantText = conclusion ? textOf(conclusion).slice(-TURN_DIGEST_ASSISTANT_MAX) : '';

  if (!userText && !assistantText) return null;
  return { userText, assistantText };
}

/** 模型习惯性包裹的引号/书名号对 */
const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
];

/**
 * 从一次性补全的回复中提取可用标题。
 * 脏输入（缺字段、错类型、错误回复）一律返回空串——标题不值得让 worker 崩。
 */
export function extractTitle(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const { content, stopReason } = message as { content?: unknown; stopReason?: unknown };
  if (stopReason === 'error' || stopReason === 'aborted') return '';
  if (!Array.isArray(content)) return '';
  const text = content
    .map((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : ''
    )
    .join('');
  // 模型可能附加解释：只取首个非空行
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  let title = line.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (title.startsWith(open) && title.endsWith(close) && title.length > open.length) {
      title = title.slice(open.length, title.length - close.length).trim();
    }
  }
  title = title.replace(/[。．.！!？?：:，,…]+$/u, '').trim();
  return title.slice(0, MAX_TITLE_CHARS);
}
