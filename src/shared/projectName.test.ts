import { describe, expect, it } from 'vitest';
import { projectDisplayName, projectNameFromPath } from './projectName';

describe('projectNameFromPath', () => {
  it('takes the last segment of posix paths', () => {
    expect(projectNameFromPath('/Users/me/code/app/')).toBe('app');
  });

  it('takes the last segment of windows paths', () => {
    expect(projectNameFromPath('D:\\code\\work\\app')).toBe('app');
    expect(projectNameFromPath('D:/code/work/app\\')).toBe('app');
  });

  it('falls back to the raw path when nothing is left', () => {
    expect(projectNameFromPath('/')).toBe('/');
  });
});

describe('projectDisplayName', () => {
  it('re-derives the name when a stored name equals the full path', () => {
    expect(projectDisplayName({ name: 'D:\\code\\app', path: 'D:\\code\\app' })).toBe('app');
  });

  it('keeps custom names', () => {
    expect(projectDisplayName({ name: 'My App', path: '/x/app' })).toBe('My App');
  });
});
