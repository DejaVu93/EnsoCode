import { describe, expect, it } from 'vitest';
import {
  DISTILL_THREAD_PROMPT,
  FEED_SYSTEM_PROMPT,
  isMemoryLanguage,
  UNIT_TYPE_CLASSIFIER_PROMPT,
  withMemoryLanguage,
} from './prompts';

describe('prompts', () => {
  it('feed prompt keeps the classification protocol', () => {
    expect(FEED_SYSTEM_PROMPT).toContain('[TYPE: capture|question|url]');
    expect(FEED_SYSTEM_PROMPT).toContain(
      '[UNIT_TYPE: fact|preference|decision|plan|procedure|learning|context|event|null]'
    );
    expect(FEED_SYSTEM_PROMPT).toContain('[TITLE: short title max 80 chars]');
    expect(FEED_SYSTEM_PROMPT).toContain('NEVER inside code fences or backticks');
  });

  it('classifier prompt names the tool and vocabulary', () => {
    expect(UNIT_TYPE_CLASSIFIER_PROMPT).toContain('classify_memory_unit_type');
    expect(UNIT_TYPE_CLASSIFIER_PROMPT).toContain('crystal is NOT a unit_type.');
  });

  it('distill prompt demands JSON only', () => {
    expect(DISTILL_THREAD_PROMPT).toContain('Return ONLY JSON:');
    expect(DISTILL_THREAD_PROMPT).toContain('importance: 0.9+ critical decision/insight');
  });

  it('language rule is appended without touching the JSON contract', () => {
    const en = withMemoryLanguage(DISTILL_THREAD_PROMPT, 'en');
    expect(en).toContain(DISTILL_THREAD_PROMPT);
    expect(en).toContain('in English');
    expect(en).toContain('JSON keys and enum values stay English.');
    expect(withMemoryLanguage(DISTILL_THREAD_PROMPT, 'zh')).toContain('Simplified Chinese');
    expect(withMemoryLanguage(DISTILL_THREAD_PROMPT, 'auto')).toContain(
      'the same language the user writes in'
    );
  });

  it('unknown or missing language falls back to English, never to no rule at all', () => {
    for (const bad of [undefined, null, '', 'klingon', 42, {}]) {
      expect(withMemoryLanguage(DISTILL_THREAD_PROMPT, bad)).toContain('in English');
    }
    expect(isMemoryLanguage('en')).toBe(true);
    expect(isMemoryLanguage('klingon')).toBe(false);
  });
});
