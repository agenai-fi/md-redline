// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { RefObject } from 'react';
import { usePageGeometry } from './usePageGeometry';

// jsdom has no ResizeObserver; the hook measures once on mount regardless.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Frames advance only when a test says so, so "settled" can be checked
// between the measurement and the paint that follows it.
let frameQueue: FrameRequestCallback[] = [];
function runFrame() {
  const due = frameQueue;
  frameQueue = [];
  act(() => due.forEach((cb) => cb(performance.now())));
}

function mountContainer(width: number): RefObject<HTMLElement | null> {
  const container = document.createElement('div');
  container.style.padding = '0px';
  Object.defineProperty(container, 'clientWidth', { value: width });
  document.body.appendChild(container);
  return { current: container };
}

beforeEach(() => {
  frameQueue = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frameQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('usePageGeometry settled', () => {
  it('stays unsettled until the measured width has been through a frame', () => {
    const ref = mountContainer(1400);
    const { result } = renderHook(() =>
      usePageGeometry(ref, true, true, undefined, true, 'doc.md'),
    );

    // Measured already: the geometry is no longer the zero-width placeholder.
    expect(result.current.pageWidth).toBeGreaterThan(416);
    expect(result.current.settled).toBe(false);

    // One frame is the paint that shows the measured width; turning the
    // transition on inside it would animate from the placeholder.
    runFrame();
    expect(result.current.settled).toBe(false);

    runFrame();
    expect(result.current.settled).toBe(true);
  });

  it('never settles on the placeholder when there is nothing to measure', () => {
    const ref: RefObject<HTMLElement | null> = { current: null };
    const { result } = renderHook(() =>
      usePageGeometry(ref, true, true, undefined, true, 'doc.md'),
    );
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(false);
  });

  it('unsettles when observation is disabled, and settles again after re-measuring', () => {
    const ref = mountContainer(1400);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePageGeometry(ref, true, enabled, undefined, true, 'doc.md'),
      {
        initialProps: { enabled: true },
      },
    );
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(true);

    rerender({ enabled: false });
    expect(result.current.settled).toBe(false);

    rerender({ enabled: true });
    expect(result.current.settled).toBe(false);
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(true);
  });

  it('never settles while there is no loaded document', () => {
    const ref = mountContainer(1400);
    const { result } = renderHook(() => usePageGeometry(ref, true, true, undefined, true, null));
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(false);
  });

  // A document's comments decide the rail's gutter, so the width can change
  // in the same render as the key. The transition must already be off then.
  it('unsettles in the same render the document changes, and settles again after it paints', () => {
    const ref = mountContainer(1400);
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string | null }) => usePageGeometry(ref, true, true, undefined, true, doc),
      { initialProps: { doc: null as string | null } },
    );
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(false);

    rerender({ doc: 'a.md' });
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(true);

    rerender({ doc: 'b.md' });
    expect(result.current.settled).toBe(false);
    runFrame();
    runFrame();
    expect(result.current.settled).toBe(true);
  });
});
