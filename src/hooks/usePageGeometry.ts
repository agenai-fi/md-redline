import { useEffect, useMemo, useState } from 'react';
import { pageGeometry, type PageGeometry, CANVAS_GUTTER, COL_MAX } from '../lib/page-geometry';

export interface ObservedPageGeometry extends PageGeometry {
  /**
   * The geometry for the current `settleKey` has been painted at least once.
   * Until then it may be the zero-width placeholder, a measurement the
   * browser has not resolved a style for yet, or a width that the arriving
   * document is about to change (its comments decide whether the rail
   * reserves a gutter). A width transition in any of those states animates
   * the page as it loads. Gate width transitions on this; resizes, rail
   * toggles and a first comment added after it still animate.
   */
  settled: boolean;
}

/**
 * Observes the scroll container's content width and derives the page
 * geometry. `enabled` gates observation (rendered view only); `railAllowed`
 * carries the non-geometry rail conditions (visibility toggle, diff, focus);
 * `reserveRail` keeps the rail's gutter width only while it has content to
 * place (collapsing the empty margin without hiding the rail's chrome);
 * `settleKey` names the loaded document, null while there is none.
 * Accounts for the canvas gutter in the available width so max-width constraints
 * on the page element never clip the rail gap.
 */
export function usePageGeometry(
  containerRef: React.RefObject<HTMLElement | null>,
  railAllowed: boolean,
  enabled: boolean,
  colMax: number = COL_MAX,
  reserveRail: boolean = true,
  settleKey: string | null = null,
): ObservedPageGeometry {
  const [contentWidth, setContentWidth] = useState(0);
  // The key that last settled. Comparing it with the current key, rather than
  // holding a boolean, unsettles in the same render the key changes, so a
  // width change that arrives with a new document never sees the transition.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const settled = settleKey !== null && settledKey === settleKey;

  useEffect(() => {
    if (!enabled) {
      setContentWidth(0);
      setSettledKey(null);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const cs = getComputedStyle(container);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      setContentWidth(Math.max(container.clientWidth - pad - CANVAS_GUTTER, 0));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    measure();
    return () => ro.disconnect();
  }, [containerRef, enabled]);

  // The placeholder is never painted, but measure()'s getComputedStyle
  // resolves its width as a style, and a transition starts from that — so
  // measuring earlier (a layout effect) would not help. Two frames, not one:
  // the first runs before the style recalc that resolves the measured width,
  // and enabling the transition inside it would still start from the
  // placeholder. A hidden tab runs no frames and stays unsettled, which only
  // costs animation until it is shown. A null key (no document, or one still
  // loading) never settles.
  useEffect(() => {
    if (settleKey === null || settled || contentWidth === 0) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettledKey(settleKey));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [contentWidth, settleKey, settled]);

  return useMemo(
    () => ({ ...pageGeometry(contentWidth, railAllowed, colMax, reserveRail), settled }),
    [contentWidth, railAllowed, colMax, reserveRail, settled],
  );
}
