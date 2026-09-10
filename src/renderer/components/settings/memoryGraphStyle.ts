import type { GraphEdgeDto, GraphNodeDto } from '@shared/memory/graphDto';
import type cytoscape from 'cytoscape';

/**
 * cytoscape 的元素与样式。抽出来是为了能直接断言「节点大小随提及数增长」
 * 「实体类型配色稳定」这类规则，而不用把整个画布渲染起来。
 */

/** 实体类型 → 色相；表外类型按名字哈希，保证同名恒同色 */
export const ENTITY_TYPE_HUES: Record<string, number> = {
  PERSON: 340,
  ORGANIZATION: 20,
  TEAM: 20,
  PRODUCT: 210,
  TOOL: 210,
  SYSTEM: 250,
  SERVICE: 250,
  PLATFORM: 250,
  CONCEPT: 160,
  METHOD: 160,
  TECHNIQUE: 160,
  EVENT: 40,
  PROJECT: 280,
  DOCUMENT: 90,
  TERM: 190,
};

export function hueFor(entityType: string): number {
  if (ENTITY_TYPE_HUES[entityType] !== undefined) return ENTITY_TYPE_HUES[entityType];
  let h = 0;
  for (let i = 0; i < entityType.length; i++) h = (h * 17 + entityType.charCodeAt(i)) >>> 0;
  return h % 360;
}

const MIN_SIZE = 22;
const MAX_SIZE = 64;

/** 面积随提及数线性增长（视觉上更诚实），所以直径走平方根 */
export function nodeSize(memoryCount: number, maxCount: number): number {
  if (maxCount <= 1) return MIN_SIZE;
  const t = Math.sqrt(Math.max(1, memoryCount)) / Math.sqrt(maxCount);
  return Math.round(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.min(1, t));
}

/**
 * 颜色必须在这里就算成字符串：样式表里写 `data(hue)` 会让 cytoscape 把数字
 * 当颜色解析，挂载时直接抛 `color.toLowerCase is not a function`。
 */
export function toElements(
  nodes: readonly GraphNodeDto[],
  edges: readonly GraphEdgeDto[],
  dark: boolean
): cytoscape.ElementDefinition[] {
  const maxCount = Math.max(1, ...nodes.map((n) => n.memoryCount));
  const ids = new Set(nodes.map((n) => n.id));
  return [
    ...nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.name,
        size: nodeSize(n.memoryCount, maxCount),
        color: hueToColor(hueFor(n.entityType), dark),
        entityType: n.entityType,
        memoryCount: n.memoryCount,
        spaceLabel: n.spaceLabel,
      },
    })),
    // 图被 limit 截断时会留下指向缺失节点的边，cytoscape 遇到会抛
    ...edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map((e) => ({
        data: {
          id: `${e.source}->${e.target}:${e.relation}`,
          source: e.source,
          target: e.target,
          label: e.relation.replace(/_/g, ' ').toLowerCase(),
          width: 1 + e.strength * 2.5,
        },
      })),
  ];
}

export interface LegendEntry {
  entityType: string;
  color: string;
  count: number;
}

/** 图例：当前图里出现的实体类型 + 配色 + 节点数，按数量倒序 */
export function buildLegend(nodes: readonly GraphNodeDto[], dark: boolean): LegendEntry[] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.entityType, (counts.get(n.entityType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([entityType, count]) => ({
      entityType,
      count,
      color: hueToColor(hueFor(entityType), dark),
    }))
    .sort((a, b) => b.count - a.count || a.entityType.localeCompare(b.entityType));
}

/** dark 由调用方传入：cytoscape 不认 CSS 变量，颜色必须是具体值 */
export function graphStylesheet(dark: boolean): cytoscape.StylesheetJson {
  const label = dark ? '#e7e7e9' : '#1c1c1f';
  const line = dark ? '#4b4b52' : '#c9c9d1';
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'background-opacity': 0.85,
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        'font-size': 11,
        color: label,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-max-width': '120px',
        'text-wrap': 'ellipsis',
        'border-width': 0,
        'transition-property': 'opacity, border-width',
        'transition-duration': 150,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 'data(width)',
        'line-color': line,
        'curve-style': 'bezier',
        opacity: 0.65,
        'font-size': 9,
        color: label,
        'text-opacity': 0,
      },
    },
    { selector: 'edge:selected, edge.highlighted', style: { 'text-opacity': 0.85, opacity: 1 } },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': label, 'background-opacity': 1 },
    },
    { selector: '.dimmed', style: { opacity: 0.18, 'text-opacity': 0.25 } },
  ] as unknown as cytoscape.StylesheetJson;
}

/**
 * hue → hex。必须是 hex：cytoscape 用自己的颜色解析器，不认现代 CSS 的
 * 空格语法 `hsl(210 68% 52%)`，解析失败会静默退化成默认灰色。
 */
export function hueToColor(hue: number, dark: boolean): string {
  return hslToHex(hue, dark ? 0.62 : 0.68, dark ? 0.58 : 0.52);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
