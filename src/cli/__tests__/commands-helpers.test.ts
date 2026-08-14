import { describe, it, expect } from 'vitest';
import { resolveShowFormat } from '../commands/_helpers.js';

describe('resolveShowFormat', () => {
  it('defaults to text when no format and no --no-color', () => {
    expect(resolveShowFormat(undefined)).toBe('text');
    expect(resolveShowFormat(undefined, false)).toBe('text');
  });

  it('defaults to markdown when --no-color is set and no format given', () => {
    expect(resolveShowFormat(undefined, true)).toBe('markdown');
  });

  it('respects explicit format over noColor default', () => {
    expect(resolveShowFormat('text', true)).toBe('text');
    expect(resolveShowFormat('html', true)).toBe('html');
  });

  it('accepts markdown, text, html', () => {
    expect(resolveShowFormat('markdown')).toBe('markdown');
    expect(resolveShowFormat('text')).toBe('text');
    expect(resolveShowFormat('html')).toBe('html');
  });

  it('rejects unknown formats', () => {
    expect(() => resolveShowFormat('json')).toThrow(/Invalid --format/);
    expect(() => resolveShowFormat('md')).toThrow(/Invalid --format/);
    expect(() => resolveShowFormat('')).toThrow(/Invalid --format/);
  });
});
