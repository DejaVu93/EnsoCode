import { describe, expect, it } from 'vitest';
import { isBrowserPartition, pageScreenshotCdpParams, partitionName } from './browserHost';

describe('partitionName', () => {
  it('dev 与打包版分罐，且都是 persist', () => {
    expect(partitionName(true)).toBe('persist:enso-browser');
    expect(partitionName(false)).toBe('persist:enso-dev-browser');
    expect(isBrowserPartition(partitionName(true))).toBe(true);
    expect(isBrowserPartition(partitionName(false))).toBe(true);
  });
  it('clear 只认我们自己的罐', () => {
    expect(isBrowserPartition('persist:enso')).toBe(false);
    expect(isBrowserPartition('enso-browser')).toBe(false);
    expect(isBrowserPartition('')).toBe(false);
  });
});

describe('pageScreenshotCdpParams', () => {
  const clip = { x: 0, y: 0, width: 1280, height: 800, scale: 1 };

  it('默认 beyond viewport，给被挡住的无头 tab 离屏出帧', () => {
    expect(pageScreenshotCdpParams(clip)).toEqual({
      format: 'png',
      captureBeyondViewport: true,
      clip,
    });
  });

  it('冻帧必须拍当前合成视口，否则 position:fixed 顶栏会丢', () => {
    expect(pageScreenshotCdpParams(undefined, { captureBeyondViewport: false })).toEqual({
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
  });
});
