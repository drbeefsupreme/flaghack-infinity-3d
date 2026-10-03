import { describe, expect, it } from 'vitest';
import { cleanText, uniqueName } from './text';

describe('cleanText', () => {
  it('collapses whitespace runs (tabs, newlines, no-break spaces) and trims', () => {
    expect(cleanText('  dr \t\n beef\u00a0\u00a0supreme  ', 24)).toBe('dr beef supreme');
  });

  it('removes control, format and lone-surrogate characters', () => {
    expect(cleanText('a\u0000b\u0007c\u202ed\u200be\u2066f\ud800g', 24)).toBe('abcdefg');
    // A zero-width character between spaces must not leave a double space behind.
    expect(cleanText('jaguar \u200b forever', 24)).toBe('jaguar forever');
  });

  it('cuts at code points, never inside a surrogate pair, and trims the cut', () => {
    expect(cleanText('🏳️'.repeat(3) + '🔥'.repeat(30), 24)).toBe(Array.from('🏳️'.repeat(3) + '🔥'.repeat(30)).slice(0, 24).join(''));
    expect(cleanText('abc def', 4)).toBe('abc');
  });

  it('leaves nothing of a name made only of blanks and invisibles', () => {
    expect(cleanText(' \u200b\t\u202e ', 24)).toBe('');
  });
});

describe('uniqueName', () => {
  it('numbers clashing names case-insensitively, keeping the result within the limit', () => {
    expect(uniqueName('alice', new Set(['bob']), 24)).toBe('alice');
    expect(uniqueName('Alice', new Set(['alice']), 24)).toBe('Alice 2');
    expect(uniqueName('alice', new Set(['alice', 'alice 2']), 24)).toBe('alice 3');
    const long = 'x'.repeat(24);
    expect(uniqueName(long, new Set([long]), 24)).toBe(`${'x'.repeat(22)} 2`);
  });
});
