/**
 * 关掉 chat wrapper 的思维链。
 *
 * 提炼 / KG 抽取是结构化抽取，不需要多步推理，但 Gemma 4、Qwen3 这类模型默认开启 CoT，
 * 会先生成一大段 thought 再产出 JSON——thought 不会出现在 prompt() 的返回值里，
 * 所以只看输出内容根本发现不了，只表现为「很慢」甚至（限了 maxTokens 时）返回空字符串。
 * 实测 gemma-4-E2B（Metal，2026-09-10）：开 65.6s / 1.1 tok/s，关 5.6s / 11.1 tok/s。
 *
 * node-llama-cpp 没有统一的开关，各 wrapper 自行其是：
 *   Gemma4ChatWrapper → reasoning: boolean
 *   QwenChatWrapper   → thoughts: 'auto' | 'discourage' | 'modelInitiated'
 * 因此这里按实例上实际存在的属性判断，并用同一个类重建。
 */

interface Switch {
  prop: string;
  /** 关闭时该属性应有的值 */
  off: unknown;
  /** 判断当前是否处于开启状态 */
  isOn: (value: unknown) => boolean;
}

const SWITCHES: Switch[] = [
  { prop: 'reasoning', off: false, isOn: (v) => v === true },
  // 'auto' / 'modelInitiated' 都会让模型自行决定是否思考；discourage 才是明确劝阻
  { prop: 'thoughts', off: 'discourage', isOn: (v) => typeof v === 'string' && v !== 'discourage' },
];

export function withoutReasoning<T extends object>(wrapper: T): T {
  const record = wrapper as unknown as Record<string, unknown>;
  const active = SWITCHES.find((s) => s.prop in record && s.isOn(record[s.prop]));
  if (!active) return wrapper;
  try {
    const Ctor = (wrapper as { constructor: unknown }).constructor as new (
      opts: Record<string, unknown>
    ) => T;
    const rebuilt = new Ctor({ [active.prop]: active.off });
    // 构造签名不匹配时可能拿到一个仍然开着 CoT 的实例，那就别用
    return (rebuilt as unknown as Record<string, unknown>)[active.prop] === active.off
      ? rebuilt
      : wrapper;
  } catch {
    // 有些 wrapper 有必填参数（如 Jinja 的 template），重建不了就保持原样：
    // 慢总比提炼直接失败好
    return wrapper;
  }
}
