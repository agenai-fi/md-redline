// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { matchViewportAnchor, viewportAnchorKey, viewportAnchorOrdinal } from './viewport-anchor';

describe('viewportAnchorKey', () => {
  it('keys on tag name, text length, and a text prefix', () => {
    const h1 = document.createElement('h1');
    h1.textContent = 'Introduction';
    expect(viewportAnchorKey(h1)).toBe('H1:12:Introduction');
  });

  it('does not collide a heading and a paragraph with identical text', () => {
    // tableScrollKey has no need for this (only tables are keyed), but a
    // viewport anchor can land on any block type, and a heading commonly
    // repeats a nearby paragraph's opening words.
    const h2 = document.createElement('h2');
    h2.textContent = 'Same text';
    const p = document.createElement('p');
    p.textContent = 'Same text';
    expect(viewportAnchorKey(h2)).not.toBe(viewportAnchorKey(p));
  });

  it('differs when the text differs', () => {
    const p1 = document.createElement('p');
    p1.textContent = 'alpha';
    const p2 = document.createElement('p');
    p2.textContent = 'beta';
    expect(viewportAnchorKey(p1)).not.toBe(viewportAnchorKey(p2));
  });
});

describe('viewportAnchorOrdinal', () => {
  it('counts the earlier blocks with the same key', () => {
    expect(viewportAnchorOrdinal(['dup', 'a', 'dup', 'dup'], 0)).toBe(0);
    expect(viewportAnchorOrdinal(['dup', 'a', 'dup', 'dup'], 3)).toBe(2);
  });
});

describe('matchViewportAnchor', () => {
  it('returns the index of the matching current key', () => {
    expect(matchViewportAnchor('b', 0, ['a', 'b', 'c'])).toBe(1);
  });

  it('returns undefined when the anchored content is gone', () => {
    // Correct behavior for a deleted/rewritten anchor is to leave the
    // reader where they are, not to guess at a replacement.
    expect(matchViewportAnchor('z', 0, ['a', 'b', 'c'])).toBeUndefined();
  });

  it('matches the same copy of a duplicated key', () => {
    expect(matchViewportAnchor('dup', 0, ['a', 'dup', 'b', 'dup'])).toBe(1);
    expect(matchViewportAnchor('dup', 1, ['a', 'dup', 'b', 'dup'])).toBe(3);
  });

  it('returns undefined when that copy no longer exists', () => {
    expect(matchViewportAnchor('dup', 1, ['a', 'dup'])).toBeUndefined();
  });
});
