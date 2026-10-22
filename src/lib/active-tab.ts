/**
 * The document a reader had active in a review, kept per browser tab.
 *
 * Reloading a `?review=` URL reopens the session's files instead of restoring
 * the saved tab session (App's restore effect skips it), so without this the
 * reload lands on the session's first file whatever the reader had open.
 * sessionStorage, keyed by review id, for the same reason the scroll offsets
 * live there (useScrollMemory): a reload returns to the same document, while a
 * new browser tab on the same review starts on the first.
 */
const KEY_PREFIX = 'md-redline-active-tab:';

export function loadActiveTab(reviewId: string): string | null {
  try {
    return sessionStorage.getItem(KEY_PREFIX + reviewId);
  } catch {
    return null;
  }
}

export function saveActiveTab(reviewId: string, filePath: string): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + reviewId, filePath);
  } catch {
    /* a full or unavailable store costs the memory, not the review */
  }
}

/**
 * The file to activate when a review's files are reopened: the saved one while
 * the session still includes it, otherwise the session's first file.
 */
export function pickActiveTab(
  filePaths: readonly string[],
  saved: string | null,
): string | undefined {
  return saved !== null && filePaths.includes(saved) ? saved : filePaths[0];
}
