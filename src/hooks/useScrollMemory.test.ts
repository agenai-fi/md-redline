// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useLayoutEffect } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { useScrollMemory } from './useScrollMemory';

/**
 * jsdom has no layout, so its `scrollTop` is a plain settable number that never
 * clamps. This stand-in clamps to `maxScroll`, the height the current document
 * allows, so a document that is shorter, or still loading, can be modelled.
 *
 * It also models the viewer's `scroll-behavior: smooth` (index.css,
 * `.overflow-y-auto`): a `scrollTo` that does not opt out of it starts an
 * animation, so the offset is NOT reached on the tick that asked for it. A
 * restore that forgets `behavior: 'instant'` therefore fails here the way it
 * animates in the browser.
 */
function makeScroller() {
  const el = {
    maxScroll: 10_000,
    _top: 0,
    /** The `behavior` of every scrollTo, in order, for assertions. */
    behaviors: [] as (ScrollBehavior | undefined)[],
    get scrollTop() {
      return el._top;
    },
    set scrollTop(v: number) {
      el._top = Math.max(0, Math.min(v, el.maxScroll));
    },
    getBoundingClientRect: () => ({ top: 0 }) as DOMRect,
    scrollTo({ top = 0, behavior }: ScrollToOptions) {
      el.behaviors.push(behavior);
      // A smooth scroll is still animating; nothing has moved yet this tick.
      if (behavior !== 'instant' && behavior !== 'auto') return;
      el.scrollTop = top;
    },
  };
  return el;
}

type Scroller = ReturnType<typeof makeScroller>;
/** `key` stands for the document's content: a new key re-renders it. */
type Props = { path: string | null; key: unknown; height?: number; rendered?: boolean };

/**
 * Mounts the hook behind a stand-in for MarkdownViewer: a layout effect that
 * puts the arriving document in, which clamps the container to its height. It
 * is declared first, as the viewer is a child of App and a child's layout
 * effects run first. React runs every layout-effect cleanup before any layout
 * effect; the hook depends on that order, and this reproduces it.
 */
function mount(
  el: Scroller,
  path: string | null,
  key: unknown = 'c0',
  getBlocks: () => Element | null = () => null,
) {
  const containerRef = { current: el as unknown as HTMLElement };
  return renderHook(
    ({ path, key, height = 10_000, rendered = true }: Props) => {
      useLayoutEffect(() => {
        el.maxScroll = height;
        el.scrollTop = Math.min(el.scrollTop, height); // a shorter document clamps it
      }, [path, key, height]);
      useScrollMemory(containerRef, getBlocks, path, rendered);
    },
    { initialProps: { path, key } as Props },
  );
}

describe('useScrollMemory', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  // Each mounted hook listens for pagehide; unmount them so one test's
  // listeners do not write into the next test's store.
  afterEach(() => {
    cleanup();
  });

  it('returns to where the reader left a document', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 1200;
    rerender({ path: '/b.md', key: 'c1' });
    el.scrollTop = 300;
    rerender({ path: '/a.md', key: 'c2' });

    expect(el.scrollTop).toBe(1200);
  });

  it('starts a document never visited at the top rather than inheriting an offset', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/long.md');

    el.scrollTop = 4000;
    rerender({ path: '/short.md', key: 'c1' });

    expect(el.scrollTop).toBe(0);
  });

  it('saves the offset a reader had, not the one a shorter document clamps it to', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/long.md');

    el.scrollTop = 4000;
    rerender({ path: '/short.md', key: 'c1', height: 200 });
    expect(el.scrollTop).toBe(0);

    rerender({ path: '/long.md', key: 'c2' });
    expect(el.scrollTop).toBe(4000);
  });

  it('waits to restore a document that is still on its first load', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 2500;
    rerender({ path: '/b.md', key: 'c1' });

    // Back to /a.md before its body has arrived.
    rerender({ path: '/a.md', key: 'c2', height: 0, rendered: false });
    expect(el.scrollTop).toBe(0);

    // The body renders.
    rerender({ path: '/a.md', key: 'c3' });
    expect(el.scrollTop).toBe(2500);

    // Every restore flips straight to the offset: the mount, the switch to
    // /b.md, and the return to /a.md once it rendered.
    expect(el.behaviors).toEqual(['instant', 'instant', 'instant']);
  });

  it('saves the target of a restore still waiting for its document', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 2500;
    rerender({ path: '/b.md', key: 'c1' });
    rerender({ path: '/a.md', key: 'c2', height: 0, rendered: false });
    // Leave /a.md before it has rendered: its offset is 2500, not 0.
    rerender({ path: '/b.md', key: 'c3' });

    expect(
      JSON.parse(sessionStorage.getItem('md-redline-scroll-positions') ?? 'null'),
    ).toMatchObject({
      '/a.md': { top: 2500 },
    });
  });

  /**
   * Leave /a.md at 2500 and come back to a version cut to 1000px while it was
   * in the background: the restore clamps to the bottom.
   */
  function returnToShortenedDocument() {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');
    el.scrollTop = 2500;
    rerender({ path: '/b.md', key: 'c1' });
    rerender({ path: '/a.md', key: 'c2', height: 1000 });
    expect(el.scrollTop).toBe(1000);
    return { el, rerender };
  }

  it('does not retry a restore that could not land when the document changes again', () => {
    const { el, rerender } = returnToShortenedDocument();

    el.scrollTop = 300;
    rerender({ path: '/a.md', key: 'c3', height: 1100 });

    expect(el.scrollTop).toBe(300);
  });

  it('saves where the reader scrolled after a restore that could not land', () => {
    const { el, rerender } = returnToShortenedDocument();

    el.scrollTop = 300;
    rerender({ path: '/b.md', key: 'c3' });

    expect(
      JSON.parse(sessionStorage.getItem('md-redline-scroll-positions') ?? 'null'),
    ).toMatchObject({
      '/a.md': { top: 300 },
    });
  });

  it('leaves the reader alone when the same document re-renders', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 900;
    rerender({ path: '/a.md', key: 'c1' });

    expect(el.scrollTop).toBe(900);
    // Only the mount restore; the re-render asks for no scroll at all.
    expect(el.behaviors).toEqual(['instant']);
  });

  it('writes the offset it leaves to sessionStorage, under the file path', () => {
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 1800;
    rerender({ path: '/b.md', key: 'c1' });

    expect(JSON.parse(sessionStorage.getItem('md-redline-scroll-positions') ?? 'null')).toEqual({
      '/a.md': { top: 1800 },
    });
  });

  it('saves the active document on pagehide, which a refresh fires without a switch', () => {
    const el = makeScroller();
    mount(el, '/a.md');

    el.scrollTop = 700;
    window.dispatchEvent(new Event('pagehide'));

    expect(JSON.parse(sessionStorage.getItem('md-redline-scroll-positions') ?? 'null')).toEqual({
      '/a.md': { top: 700 },
    });
  });

  it('restores an offset that only sessionStorage has', () => {
    // What a refresh mid-review leaves behind: the store, and nothing in
    // memory. A hook that never saw the reader scroll still has to find it.
    sessionStorage.setItem(
      'md-redline-scroll-positions',
      JSON.stringify({ '/a.md': { top: 1800 } }),
    );
    const el = makeScroller();
    mount(el, '/a.md');

    expect(el.scrollTop).toBe(1800);
  });

  it('starts at the top when the stored offsets are unreadable', () => {
    sessionStorage.setItem('md-redline-scroll-positions', 'not json');
    const el = makeScroller();
    const { rerender } = mount(el, '/a.md');

    el.scrollTop = 600;
    rerender({ path: '/b.md', key: 'c1' });

    expect(el.scrollTop).toBe(0);
  });

  /**
   * A document's top-level blocks, laid out as a stack of equal-height blocks
   * whose rects follow the scroller. Changing `height` reflows the document:
   * the same block moves to a different pixel offset.
   */
  function makeBlocks(el: Scroller, count: number, height: number) {
    const layout = { height };
    const children = Array.from({ length: count }, (_, i) => ({
      tagName: 'P',
      textContent: `Block ${i}`,
      getBoundingClientRect: () => {
        const top = i * layout.height - el.scrollTop;
        return { top, bottom: top + layout.height } as DOMRect;
      },
    }));
    const blocks = { children, isConnected: true } as unknown as Element;
    return { blocks, layout };
  }

  it('returns to the same block after the document reflows', () => {
    const el = makeScroller();
    const a = makeBlocks(el, 60, 100);
    const empty = { children: [], isConnected: true } as unknown as Element;
    let current: Element = a.blocks;
    const { rerender } = mount(el, '/a.md', 'c0', () => current);

    // Block 12 is 50px above the viewport top.
    el.scrollTop = 1250;
    current = empty;
    rerender({ path: '/b.md', key: 'c1' });

    // /a.md reflows while away (a resize, a font change): blocks are taller.
    a.layout.height = 150;
    current = a.blocks;
    rerender({ path: '/a.md', key: 'c2' });

    // Block 12 back at -50px, not the old pixel offset 1250.
    expect(el.scrollTop).toBe(12 * 150 + 50);
  });

  it('returns to the same block on a reload after a reflow', () => {
    const el = makeScroller();
    const a = makeBlocks(el, 60, 100);
    const { unmount } = mount(el, '/a.md', 'c0', () => a.blocks);

    el.scrollTop = 1250;
    window.dispatchEvent(new Event('pagehide'));
    unmount();

    // The reloaded page lays the document out differently.
    const reloaded = makeScroller();
    const b = makeBlocks(reloaded, 60, 80);
    mount(reloaded, '/a.md', 'c0', () => b.blocks);

    expect(reloaded.scrollTop).toBe(12 * 80 + 50);
  });

  it('falls back to the pixel offset when the saved block is gone', () => {
    const el = makeScroller();
    const a = makeBlocks(el, 60, 100);
    const empty = { children: [], isConnected: true } as unknown as Element;
    let current: Element = a.blocks;
    const { rerender } = mount(el, '/a.md', 'c0', () => current);

    el.scrollTop = 1250;
    current = empty;
    rerender({ path: '/b.md', key: 'c1' });

    // /a.md comes back rewritten: none of its blocks match.
    const rewritten = makeBlocks(el, 60, 100);
    rewritten.blocks.children[12].textContent = 'Rewritten';
    for (const child of Array.from(rewritten.blocks.children)) child.textContent += '!';
    current = rewritten.blocks;
    rerender({ path: '/a.md', key: 'c2' });

    expect(el.scrollTop).toBe(1250);
  });
});
