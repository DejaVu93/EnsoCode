/** 离屏测量：仍给 800×600 让 mermaid 排版，但 fixed+hidden，避免 iOS 把绝对定位大盒子滚进视口 */
export const MERMAID_OFFSCREEN_HOST_STYLE =
  'position:fixed;left:0;top:0;width:800px;height:600px;overflow:hidden;opacity:0;pointer-events:none;visibility:hidden;contain:strict;';

/** 避免 SVG 插入后成为可聚焦块，iOS 会 scrollIntoView 把聊天滚回图上 */
export function decorateMermaidSvg(svg: string): string {
  if (!svg.includes('<svg') || /\bfocusable=/.test(svg)) return svg;
  return svg.replace('<svg', '<svg focusable="false" tabindex="-1"');
}
