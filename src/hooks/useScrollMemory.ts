import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  captureViewportAnchor,
  viewportAnchorScrollTop,
  type ViewportAnchor,
} from '../lib/viewport-anchor';

const STORAGE_KEY = 'md-redline-scroll-positions';

/**
 * Where the reader was in one document: the block they were reading (see
 * lib/viewport-anchor.ts), and the pixel offset as a fallback for when that
 * block cannot be found — it was edited, or the reader was at the very top.
 */
interface SavedPosition {
  top: number;
  anchor?: ViewportAnchor;
}

function isSavedPosition(value: unknown): value is SavedPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { top, anchor } = value as { top?: unknown; anchor?: unknown };
  if (typeof top !== 'number' || !Number.isFinite(top)) return false;
  if (anchor === undefined) return true;
  if (typeof anchor !== 'object' || anchor === null) return false;
  const { key, ordinal, offset } = anchor as Record<string, unknown>;
  return typeof key === 'string' && typeof ordinal === 'number' && typeof offset === 'number';
}

/**
 * Positions live in sessionStorage rather than in a ref so a refresh
 * mid-review returns every document to where the reader left it.
 * sessionStorage and not localStorage: a position is worth keeping for as long
 * as the tab is open and no longer — a document reopened days later should
 * start at the top.
 */
function loadPositions(): Record<string, SavedPosition> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const positions: Record<string, SavedPosition> = {};
    for (const [path, position] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSavedPosition(position)) positions[path] = position;
    }
    return positions;
  } catch {
    return {};
  }
}

function savePosition(path: string, position: SavedPosition): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPositions(), [path]: position }));
  } catch {
    /* a full or unavailable store costs the memory, not the review */
  }
}

/**
 * Scroll to a saved position: to its block when that block is in the
 * document, otherwise to its pixel offset. Returns whether it landed; it has
 * not when the block is missing and the document is still too short for the
 * offset, as when the document has not finished rendering.
 */
function restorePosition(
  scroller: HTMLElement,
  blocks: Element | null,
  position: SavedPosition,
): boolean {
  const anchored =
    position.anchor && blocks
      ? viewportAnchorScrollTop(scroller, blocks, position.anchor)
      : undefined;
  // `behavior: 'instant'` overrides the `scroll-behavior: smooth` the viewer
  // has (index.css, `.overflow-y-auto`). A restore is not navigation the
  // reader asked for; animating it reads as the document scrolling itself.
  scroller.scrollTo({ top: anchored ?? position.top, behavior: 'instant' });
  return anchored !== undefined || scroller.scrollTop >= position.top;
}

/**
 * Remembers where the reader was in each document, so switching tabs or
 * reloading returns them to the same text instead of applying one document's
 * offset to the next. `getBlocks` returns the element whose children are the
 * document's top-level blocks (MarkdownViewer's container).
 *
 * The outgoing position is read in a layout-effect cleanup. React runs
 * cleanups in the commit's mutation phase, before any layout effect, and
 * MarkdownViewer swaps the arriving document in from a layout effect, so at
 * cleanup time the container still holds the outgoing document. A read in the
 * effect body comes too late: the arriving document is already in, and if it
 * is shorter the browser has clamped scrollTop to fit it.
 *
 * `contentKey` is whatever changes when the document body actually renders. A
 * tab activated while still loading has neither the saved block nor the
 * height for the saved offset, so the restore is retried on the next content
 * change.
 *
 * Nothing prunes the map: it holds one position per file visited, for the
 * life of the tab.
 */
export function useScrollMemory(
  containerRef: RefObject<HTMLElement | null>,
  getBlocks: () => Element | null,
  activeFilePath: string | null,
  contentKey: unknown,
): void {
  const prevPath = useRef<string | null>(null);
  // A restore that has not landed yet, because the arriving document was still
  // rendering. Null once it has.
  const pending = useRef<SavedPosition | null>(null);

  // Save on the way out: when the active document changes (the cleanup), and
  // on pagehide, since a refresh or a closed browser tab never switches away.
  // A pending restore saves the position it was heading for.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || activeFilePath === null) return;
    const path = activeFilePath;
    const blocks = getBlocks();
    const save = () =>
      savePosition(
        path,
        pending.current ?? {
          top: el.scrollTop,
          anchor: blocks?.isConnected ? captureViewportAnchor(el, blocks) : undefined,
        },
      );
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [containerRef, getBlocks, activeFilePath]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || activeFilePath === null) return;

    if (prevPath.current !== activeFilePath) {
      prevPath.current = activeFilePath;
      pending.current = loadPositions()[activeFilePath] ?? { top: 0 };
    } else if (pending.current === null) {
      // Same document and nothing outstanding — the reader is where they put
      // themselves, so leave them there.
      return;
    }

    const position = pending.current;
    pending.current = restorePosition(el, getBlocks(), position) ? null : position;
  }, [containerRef, getBlocks, activeFilePath, contentKey]);
}
