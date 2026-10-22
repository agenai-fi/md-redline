import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Inside the worktree, so the server's allowed-roots check passes (see
// agent-asks.spec.ts).
const TEMP_FIXTURE_DIR = resolve(__dirname, 'fixtures', 'scroll-memory-tmp');

test.use({ viewport: { width: 1700, height: 950 } });

/** A document of `count` sections, each a heading and one paragraph. */
function sections(count: number): string {
  let md = '# Long document\n\n';
  for (let i = 1; i <= count; i++) {
    md += `## Section ${i}\n\nParagraph ${i}, long enough to wrap onto a second line at this width so that every section takes up some real height in the document view.\n\n`;
  }
  return md;
}

async function abortAllSessions(
  baseURL: string,
  request: import('@playwright/test').APIRequestContext,
) {
  const res = await request.get(`${baseURL}/api/review-sessions`);
  if (!res.ok()) return;
  const { sessions } = (await res.json()) as { sessions: { id: string; status: string }[] };
  for (const s of sessions.filter((s) => s.status === 'open')) {
    await request.post(`${baseURL}/api/review-sessions/${s.id}/abort`, {
      headers: { 'content-type': 'application/json' },
    });
  }
}

const tabFor = (page: Page, path: string) => page.locator(`[title="${path}"].rounded-t-md`);

/** The scroll container the documents share. */
function scrollerTop(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('[data-doc-page]')!.parentElement!.scrollTop);
}

function scrollerMax(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-doc-page]')!.parentElement!;
    return el.scrollHeight - el.clientHeight;
  });
}

/** Scroll as a reader would land there, without the viewer's smooth scrolling. */
async function scrollTo(page: Page, top: number) {
  await page.evaluate((top) => {
    document
      .querySelector('[data-doc-page]')!
      .parentElement!.scrollTo({ top, behavior: 'instant' });
  }, top);
  // Let the scroll event and anything it schedules run.
  await page.waitForTimeout(100);
}

async function scrollToHeading(page: Page, name: string) {
  const top = await page.evaluate((name) => {
    const el = document.querySelector('[data-doc-page]')!.parentElement!;
    const heading = Array.from(el.querySelectorAll('h2')).find((h) => h.textContent === name)!;
    return el.scrollTop + heading.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, name);
  await scrollTo(page, top);
}

function savedPositions(page: Page): Promise<Record<string, { top: number }>> {
  return page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('md-redline-scroll-positions') ?? '{}'),
  );
}

test.describe('Reading position across tabs', () => {
  let fixtureDir = '';
  let longPath = '';
  let shortPath = '';

  test.beforeEach(async ({ page, request, baseURL }, testInfo) => {
    await abortAllSessions(baseURL!, request);
    fixtureDir = resolve(TEMP_FIXTURE_DIR, `${process.pid}-${testInfo.retry}-${Date.now()}`);
    mkdirSync(fixtureDir, { recursive: true });
    longPath = resolve(fixtureDir, 'long.md');
    shortPath = resolve(fixtureDir, 'short.md');
    writeFileSync(longPath, sections(80));
    writeFileSync(shortPath, '# Short document\n\nOne paragraph.\n');

    const res = await request.post(`${baseURL}/api/review-sessions`, {
      data: { filePaths: [longPath, shortPath], origin: 'agent' },
    });
    expect(res.status()).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    testInfo.annotations.push({ type: 'session', description: sessionId });
    await page.goto(`/?review=${encodeURIComponent(sessionId)}`);
    await expect(page.getByRole('heading', { name: 'Section 80' })).toBeAttached({
      timeout: 12_000,
    });
    // The SSE file-watcher connection, which delivers the edits below.
    await page.waitForTimeout(500);
  });

  test.afterEach(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  test.afterAll(() => {
    rmSync(TEMP_FIXTURE_DIR, { recursive: true, force: true });
  });

  /**
   * Leave the long document at Section 61, cut it to 20 sections while it is
   * in the background, and come back. Its saved block is gone and its saved
   * offset is past the end, so the restore cannot land.
   */
  async function returnToCutDocument(page: Page) {
    await scrollToHeading(page, 'Section 61');
    await tabFor(page, shortPath).click();
    await expect(page.getByRole('heading', { name: 'Short document' })).toBeVisible();

    // The background tabs' watcher reconnects on every switch, and an edit made
    // before it is up never reaches the tab. Nothing on screen shows a
    // background tab's content arriving, so wait it out.
    await page.waitForTimeout(500);
    writeFileSync(longPath, sections(20));
    await page.waitForTimeout(1000);
    await tabFor(page, longPath).click();
    await expect(page.getByRole('heading', { name: 'Section 20' })).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Section 21' })).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(await scrollerTop(page)).toBe(await scrollerMax(page));
  }

  test('a restore that cannot land does not pull the reader back on the next edit', async ({
    page,
  }) => {
    await returnToCutDocument(page);

    await scrollTo(page, 800);
    appendFileSync(longPath, 'An appended line.\n');
    await expect(page.getByText('An appended line.')).toBeAttached();
    await page.waitForTimeout(200);

    expect(await scrollerTop(page)).toBe(800);
  });

  test('leaving a document whose restore could not land saves where the reader is', async ({
    page,
  }) => {
    await returnToCutDocument(page);

    await scrollTo(page, 800);
    await tabFor(page, shortPath).click();
    await expect(page.getByRole('heading', { name: 'Short document' })).toBeVisible();

    expect((await savedPositions(page))[longPath]).toMatchObject({ top: 800 });
    await tabFor(page, longPath).click();
    await page.waitForTimeout(200);
    expect(await scrollerTop(page)).toBe(800);
  });

  test('a jump to a question in another document stays put on the next edit', async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    await returnToCutDocument(page);
    await tabFor(page, shortPath).click();
    await expect(page.getByRole('heading', { name: 'Short document' })).toBeVisible();
    // Back at the unreachable position: the reader has not scrolled since.
    expect((await savedPositions(page))[longPath].top).toBeGreaterThan(await scrollerMax(page));

    const sessionId = testInfo.annotations.find((a) => a.type === 'session')!.description!;
    const ask = await request.post(`${baseURL}/api/review-sessions/${sessionId}/agent-comments`, {
      data: {
        questions: [{ filePath: longPath, anchor: 'Paragraph 12, long', text: 'Is 12 right?' }],
      },
    });
    expect(ask.status()).toBe(201);

    await page.getByRole('button', { name: /Jump to the first question/ }).click();
    const mark = page.locator('[data-doc-page] mark').first();
    await expect(mark).toBeInViewport({ timeout: 5_000 });
    // Let the jump's smooth scroll finish.
    await page.waitForTimeout(800);
    const afterJump = await scrollerTop(page);
    expect(afterJump).toBeLessThan(await scrollerMax(page));

    appendFileSync(longPath, 'An appended line.\n');
    await expect(page.getByText('An appended line.')).toBeAttached();
    await page.waitForTimeout(200);

    expect(await scrollerTop(page)).toBe(afterJump);
    await expect(mark).toBeInViewport();
  });
});
