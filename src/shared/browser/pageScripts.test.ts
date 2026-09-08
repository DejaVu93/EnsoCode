import { describe, expect, it } from 'vitest';
import {
  DESIGN_MODE_BINDING,
  PAGE_DESIGN_MODE_DISABLE_SCRIPT,
  PAGE_DESIGN_MODE_ENABLE_SCRIPT,
  PAGE_DESIGN_MODE_HIDE_SCRIPT,
  PAGE_LOCK_OVERLAY_SCRIPT,
  PAGE_UNLOCK_OVERLAY_SCRIPT,
} from './pageScripts';

const runUnlock = (nodes: { id: string }[]): unknown => {
  const document = {
    getElementById: (id: string) => {
      const el = nodes.find((n) => n.id === id);
      return el ? { remove: () => nodes.splice(nodes.indexOf(el), 1) } : null;
    },
  };
  return new Function('document', `return ${PAGE_UNLOCK_OVERLAY_SCRIPT}`)(document);
};

describe('lock overlay scripts', () => {
  it('installs a full-page overlay and can remove it', () => {
    expect(PAGE_LOCK_OVERLAY_SCRIPT).toContain('enso-browser-lock-overlay');
    expect(PAGE_LOCK_OVERLAY_SCRIPT).toContain('preventDefault');
    expect(PAGE_UNLOCK_OVERLAY_SCRIPT).toContain('enso-browser-lock-overlay');
    expect(PAGE_UNLOCK_OVERLAY_SCRIPT).toContain('.remove()');
  });

  it('unlock is idempotent and only reports ok when the node is really gone', () => {
    expect(runUnlock([])).toBe('ok');
    const nodes = [{ id: 'enso-browser-lock-overlay' }, { id: 'enso-browser-lock-overlay' }];
    expect(runUnlock(nodes)).toBe('ok');
    expect(nodes).toHaveLength(0);
  });

  it('unlock reports failure when the overlay survives removal', () => {
    const document = {
      getElementById: (id: string) =>
        id === 'enso-browser-lock-overlay' ? { remove: () => {} } : null,
    };
    const result = new Function('document', `return ${PAGE_UNLOCK_OVERLAY_SCRIPT}`)(document);
    expect(result).not.toBe('ok');
  });
});

describe('design mode scripts', () => {
  it('uses binding + WeakMap-free overlay id, and hide/disable stay self-contained', () => {
    expect(DESIGN_MODE_BINDING).toBe('ensoDesignMode');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('enso-design-mode-root');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('ensoDesignMode');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('__ensoDesignMode');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("type: 'picked'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("type: 'cancelled'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("addEventListener('pointerup'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('|| hoverEl');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('picking');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('pointerup');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('pointercancel');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('setPointerCapture');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('freeze-request');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('pendingCommit');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('showActions');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('cropCard');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('inChrome');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('actions.contains');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('cropDrag');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('dataset.handle');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('crop.y + crop.height + 10');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('annotated');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('composeImage');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('showFrozen');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('hoverTag');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('Esc');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('raw.left - 48');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain('120 - (right - left)');
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).not.toContain('data-enso');
    expect(PAGE_DESIGN_MODE_HIDE_SCRIPT).toContain('hide');
    expect(PAGE_DESIGN_MODE_DISABLE_SCRIPT).toContain('setEnabled(false)');
  });

  it('enable script is valid JavaScript', () => {
    expect(() => new Function(PAGE_DESIGN_MODE_ENABLE_SCRIPT)).not.toThrow();
  });

  it('clips freeze overlay and locks replaced-element boxes so guest layout cannot grow', () => {
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("overflow: 'hidden'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("contain: 'strict'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("setProperty('width'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("setProperty('height'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("'important'");
  });

  it('hides freeze layer before host screenshot so the shot is the live viewport, not overlay chrome', () => {
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("freezeLayer.style.visibility = 'hidden'");
    expect(PAGE_DESIGN_MODE_ENABLE_SCRIPT).toContain("freezeLayer.style.visibility = ''");
    expect(PAGE_DESIGN_MODE_HIDE_SCRIPT).toContain('hide');
  });
});
