import { translate } from '@shared/i18n';

/**
 * `@/i18n` 的 PWA 桩：桌面版从 zustand 取语言，这里跟随系统。
 * 经 vite alias 注入，复用桌面聊天组件时无需改动它们。
 *
 * t / tNode 必须是模块级稳定引用：MermaidRenderer 等 effect 依赖 t，
 * 每次 render 新建函数会反复重绘图表，手机上把滚动吸回图上。
 */

const locale: 'zh' | 'en' =
  typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en';

function t(key: string, params?: Record<string, string | number>) {
  return translate(locale, key, params);
}

function tNode(key: string, params?: Record<string, React.ReactNode>) {
  const template = translate(locale, key);
  if (!params) return template;
  const parts = template.split(/(\{\{\w+\}\})/g);
  return parts.map((part) => {
    const match = /^\{\{(\w+)\}\}$/.exec(part);
    if (!match) return part;
    const value = params[match[1]];
    return value === undefined ? part : <span key={match[1]}>{value}</span>;
  });
}

export function useI18n() {
  return { locale, t, tNode };
}
