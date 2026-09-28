// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadActiveTab, pickActiveTab, saveActiveTab } from './active-tab';

describe('active tab', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns the saved file for its review', () => {
    saveActiveTab('rev_a', '/docs/b.md');
    expect(loadActiveTab('rev_a')).toBe('/docs/b.md');
  });

  it('keeps each review separate', () => {
    saveActiveTab('rev_a', '/docs/b.md');
    expect(loadActiveTab('rev_other')).toBeNull();
  });

  it('picks the saved file when the session still includes it', () => {
    expect(pickActiveTab(['/a.md', '/b.md', '/c.md'], '/b.md')).toBe('/b.md');
  });

  it('falls back to the first file when nothing is saved', () => {
    expect(pickActiveTab(['/a.md', '/b.md'], null)).toBe('/a.md');
  });

  it('falls back to the first file when the saved one left the session', () => {
    expect(pickActiveTab(['/a.md', '/b.md'], '/gone.md')).toBe('/a.md');
  });
});
