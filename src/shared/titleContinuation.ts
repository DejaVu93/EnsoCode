/**
 * 推进类回合判定（shared：worker 的 initial 清洗与 renderer 的滚动总结跳过共用一份词表）。
 * “继续 / 开始实施 / 好的做吧 / go ahead”这类只推动同一话题往前走的短句，不该触发标题重写——
 * 真机已证纯 prompt 约束对不听话的模型无效，renderer 直接跳过才可靠。
 */

/** 推进短句词表（小写、已去标点）：整句拆片后每一片都在表里才算推进，带实词（“继续排查 X”）就不算 */
const CONTINUATION_PHRASES: ReadonlySet<string> = new Set([
  '从这里继续',
  '继续',
  '接着',
  '接着做',
  '然后呢',
  '下一步',
  '开始',
  '开始实施',
  '开始做',
  '实施',
  '按 prd 实施',
  '按计划实施',
  '执行',
  '去做',
  '做吧',
  '好的',
  '好',
  '可以',
  '行',
  '嗯',
  'ok',
  'okay',
  'go',
  'go ahead',
  'continue',
  'continue here',
  'proceed',
  'do it',
  'yes',
  'yep',
  'next',
  'start',
  'start implementing',
  'implement',
  'implement it',
]);

/** 推进短句里允许夹带的连接/语气片：“好的，做吧”拆成 [好的, 做吧] 逐片查表；片内空白保留（"go ahead"） */
const CONTINUATION_SPLIT = /[,，、;；.。!！?？:：~～\n]+/;

/**
 * 去空白与标点后非空，且按连接符拆出的每一片都在推进词表里 → true。
 */
export function isContinuationTurn(text: string): boolean {
  const pieces = text
    .toLowerCase()
    .split(CONTINUATION_SPLIT)
    .map((piece) => piece.trim().replace(/\s+/g, ' '))
    .filter((piece) => piece.length > 0);
  if (pieces.length === 0) return false;
  return pieces.every((piece) => CONTINUATION_PHRASES.has(piece));
}
