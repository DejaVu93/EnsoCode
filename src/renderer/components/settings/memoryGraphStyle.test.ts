import type { GraphEdgeDto, GraphNodeDto } from '@shared/memory/graphDto';
import { describe, expect, it } from 'vitest';
import {
  buildLegend,
  graphStylesheet,
  hueFor,
  hueToColor,
  nodeSize,
  toElements,
} from './memoryGraphStyle';

function node(id: string, memoryCount = 1, entityType = 'CONCEPT'): GraphNodeDto {
  return { id, name: id, entityType, memoryCount, spaceId: 'global', spaceLabel: 'Global' };
}

const edge = (source: string, target: string, strength = 0.5): GraphEdgeDto => ({
  source,
  target,
  relation: 'DEPENDS_ON',
  strength,
});

describe('nodeSize', () => {
  it('grows with mention count and stays bounded', () => {
    expect(nodeSize(1, 1)).toBe(22);
    expect(nodeSize(1, 100)).toBeLessThan(nodeSize(50, 100));
    expect(nodeSize(100, 100)).toBe(64);
    // 计数超过 max（分页边界）也不能撑破上限
    expect(nodeSize(500, 100)).toBe(64);
  });
});

describe('toElements', () => {
  it('drops edges whose endpoints were cut by the node limit', () => {
    // 图被 limit 截断后仍会带回指向缺失节点的边，喂给 cytoscape 会直接抛
    const elements = toElements(
      [node('a'), node('b')],
      [edge('a', 'ghost'), edge('a', 'b')],
      false
    );
    const edges = elements.filter((el) => 'source' in (el.data as Record<string, unknown>));
    expect(edges).toHaveLength(1);
    expect((edges[0].data as { source: string }).source).toBe('a');
  });

  it('drops self-loops', () => {
    const elements = toElements([node('a')], [edge('a', 'a')], false);
    expect(elements.filter((el) => 'source' in (el.data as Record<string, unknown>))).toEqual([]);
  });

  it('carries size and hue onto node data', () => {
    const elements = toElements([node('small', 1), node('big', 9, 'PERSON')], [], false);
    const dataOf = (id: string) => {
      const found = elements.find((el) => (el.data as { id: string }).id === id);
      if (!found) throw new Error(`missing node ${id}`);
      return found.data as { color: unknown; size: number };
    };
    // 必须是颜色字符串：给 cytoscape 一个数字会在挂载时抛
    // `color.toLowerCase is not a function`
    expect(typeof dataOf('big').color).toBe('string');
    expect(dataOf('big').color).toBe(hueToColor(340, false));
    expect(dataOf('small').color).not.toBe(dataOf('big').color);
    expect(dataOf('big').size).toBeGreaterThan(dataOf('small').size);
  });

  it('humanizes relation labels', () => {
    const elements = toElements([node('a'), node('b')], [edge('a', 'b')], false);
    const relation = elements.find((el) => 'source' in (el.data as Record<string, unknown>));
    if (!relation) throw new Error('edge missing');
    expect((relation.data as { label: string }).label).toBe('depends on');
  });
});

describe('stylesheet contract', () => {
  it('never maps a color property to a numeric data field', () => {
    // 这正是上一版的崩溃原因：'background-color': 'data(hue)' 而 hue 是数字
    const sheet = graphStylesheet(false) as unknown as {
      style: Record<string, unknown>;
    }[];
    const nodeStyle = sheet[0].style;
    const elements = toElements([node('a')], [], false);
    const mapped = String(nodeStyle['background-color']);
    const field = /^data\((.+)\)$/.exec(mapped)?.[1];
    if (field) {
      expect(typeof (elements[0].data as Record<string, unknown>)[field]).toBe('string');
    }
  });
});

describe('buildLegend', () => {
  it('lists the types present, most common first, with matching colours', () => {
    const legend = buildLegend(
      [node('a', 1, 'TOOL'), node('b', 1, 'CONCEPT'), node('c', 1, 'TOOL')],
      false
    );
    expect(legend.map((e) => e.entityType)).toEqual(['TOOL', 'CONCEPT']);
    expect(legend[0].count).toBe(2);
    // 图例色点必须与节点用同一套配色，否则图例是错的
    expect(legend[0].color).toBe(hueToColor(hueFor('TOOL'), false));
  });

  it('is empty for an empty graph', () => {
    expect(buildLegend([], false)).toEqual([]);
  });
});

describe('hueFor / hueToColor', () => {
  it('is stable for known and unknown types', () => {
    expect(hueFor('PERSON')).toBe(340);
    expect(hueFor('MADE_UP')).toBe(hueFor('MADE_UP'));
    expect(hueFor('MADE_UP')).toBeLessThan(360);
  });

  it('produces hex, not modern CSS hsl (cytoscape has its own parser)', () => {
    // `hsl(210 68% 52%)` 这种空格语法 cytoscape 解析不了，会静默退化成灰色
    for (const dark of [true, false]) {
      for (const hue of [0, 45, 100, 160, 210, 280, 340, 359]) {
        expect(hueToColor(hue, dark)).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(hueToColor(210, true)).not.toBe(hueToColor(210, false));
    // 不同色相必须给出不同颜色，否则整张图会是单色
    expect(hueToColor(340, false)).not.toBe(hueToColor(160, false));
  });
});
