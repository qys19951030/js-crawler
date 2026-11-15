import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpResponse } from '../src/types.js';
import type { PageRecord } from '../src/records.js';

// Mock the request module
vi.mock('../src/request.js', () => ({
  makeRequest: vi.fn(),
}));

// Mock the robots module
vi.mock('../src/robots.js', () => {
  const RobotsCache = vi.fn().mockImplementation(() => ({
    isAllowed: vi.fn().mockResolvedValue(true),
    clear: vi.fn(),
  }));
  return { RobotsCache };
});

import Crawler from '../src/crawler.js';
import { makeRequest } from '../src/request.js';

const mockedMakeRequest = vi.mocked(makeRequest);

function htmlResponse(url: string, body: string): HttpResponse {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from(body),
    statusCode: 200,
    url,
    redirectUrls: [],
  };
}

function binaryResponse(url: string): HttpResponse {
  return {
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    statusCode: 200,
    url,
    redirectUrls: [],
  };
}

function linksPage(url: string, links: string[]): HttpResponse {
  const anchors = links.map((l) => `<a href="${l}">x</a>`).join('');
  return htmlResponse(url, `<html><body>${anchors}</body></html>`);
}

function readRecords(dir: string): PageRecord[] {
  const file = join(dir, 'records.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as PageRecord);
}

function readProgress(dir: string): {
  options: Record<string, unknown>;
  pageCount: number;
  visitedUrls: string[];
  crawledUrls: string[];
  queue: { url: string; depth: number; referer: string }[];
} {
  return JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
}

describe('persistent crawl sessions (sessionDir)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'js-crawler-session-'));
    mockedMakeRequest.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('persists progress and page records on the first crawl', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const crawler = new Crawler();
    crawler.configure({ sessionDir: dir, depth: 2 });
    const urls = await crawler.crawl('http://example.com/');
    expect(urls).toEqual(['http://example.com/', 'http://example.com/a']);

    const progress = readProgress(dir);
    expect(progress.pageCount).toBe(2);
    expect(progress.options.depth).toBe(2);
    expect(progress.visitedUrls).toContain('http://example.com/');
    expect(progress.visitedUrls).toContain('http://example.com/a');
    expect(progress.crawledUrls).toContain('http://example.com/');
    expect(progress.queue).toEqual([]);

    const records = readRecords(dir);
    expect(records).toHaveLength(2);

    const [root, leaf] = records;
    expect(root.url).toBe('http://example.com/');
    expect(root.status).toBe(200);
    expect(root.depth).toBe(2);
    expect(root.referer).toBe('');
    expect(root.error).toBeNull();
    expect(root.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(() => new Date(root.fetchedAt).toISOString()).not.toThrow();

    expect(leaf.url).toBe('http://example.com/a');
    expect(leaf.depth).toBe(1);
    expect(leaf.referer).toBe('http://example.com/');
  });

  it('resumes an interrupted crawl from the same session directory', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a', '/b']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    // First "process": interrupted after the second page.
    const first = new Crawler();
    first.configure({ sessionDir: dir, depth: 2 });
    let pages = 0;
    first.on('page', () => {
      pages += 1;
      if (pages === 2) first.stop();
    });
    await first.crawl('http://example.com/');
    // The interruption happened mid-crawl, but both fetched pages made
    // it to disk before the process "went away".
    expect(readRecords(dir)).toHaveLength(2);
    expect(readRecords(dir).map((r) => r.url).sort()).toEqual([
      'http://example.com/',
      'http://example.com/a',
    ]);
    const recordsAfterFirstRun = readFileSync(
      join(dir, 'records.jsonl'),
      'utf8',
    );

    // Second "process": a brand new crawler on the same directory.
    mockedMakeRequest.mockClear();
    const second = new Crawler();
    second.configure({ sessionDir: dir, depth: 5 });
    const secondUrls = await second.crawl('http://example.com/');

    // Only the remaining page is crawled and returned.
    expect(secondUrls).toEqual(['http://example.com/b']);
    expect(mockedMakeRequest).toHaveBeenCalledTimes(1);
    expect(mockedMakeRequest.mock.calls[0][0].url).toBe(
      'http://example.com/b',
    );

    // The new record keeps the depth/referer from first discovery.
    const records = readRecords(dir);
    expect(records).toHaveLength(3);
    const bRecord = records.find((r) => r.url === 'http://example.com/b')!;
    expect(bRecord.depth).toBe(1);
    expect(bRecord.referer).toBe('http://example.com/');

    // Existing records.jsonl lines are never rewritten.
    const finalContent = readFileSync(join(dir, 'records.jsonl'), 'utf8');
    expect(finalContent.startsWith(recordsAfterFirstRun)).toBe(true);

    // Persisted crawl options win over newly configured ones.
    expect(readProgress(dir).options.depth).toBe(2);
  });

  it('fetches a URL only once no matter how many pages reference it', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a', '/a#frag', '/b']);
      }
      if (opts.url === 'http://example.com/a') {
        return linksPage(opts.url, [
          '/b#section',
          'http://EXAMPLE.com/b',
          'http://example.com/b',
        ]);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const crawler = new Crawler();
    crawler.configure({ sessionDir: dir, depth: 3 });
    const urls = await crawler.crawl('http://example.com/');

    expect(urls.sort()).toEqual([
      'http://example.com/',
      'http://example.com/a',
      'http://example.com/b',
    ]);
    const requestedUrls = mockedMakeRequest.mock.calls.map((c) => c[0].url);
    expect(requestedUrls.sort()).toEqual([
      'http://example.com/',
      'http://example.com/a',
      'http://example.com/b',
    ]);

    const records = readRecords(dir);
    expect(records).toHaveLength(3);
    expect(
      records.filter((r) => r.url === 'http://example.com/b'),
    ).toHaveLength(1);
  });

  it('accumulates maxPages across processes and ignores a larger limit on resume', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a', '/b', '/c', '/d']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    // First process crawls 2 pages of the maxPages=3 quota, then stops.
    const first = new Crawler();
    first.configure({ sessionDir: dir, depth: 2, maxPages: 3 });
    let pages = 0;
    first.on('page', () => {
      pages += 1;
      if (pages === 2) first.stop();
    });
    await first.crawl('http://example.com/');
    expect(readRecords(dir)).toHaveLength(2);
    expect(readProgress(dir).pageCount).toBe(2);

    // Resume: the quota continues from 2, and maxPages=100 must not
    // override the persisted limit of 3.
    mockedMakeRequest.mockClear();
    const second = new Crawler();
    second.configure({ sessionDir: dir, depth: 2, maxPages: 100 });
    const secondUrls = await second.crawl('http://example.com/');

    expect(secondUrls).toHaveLength(1);
    expect(readRecords(dir)).toHaveLength(3);
    expect(readProgress(dir).pageCount).toBe(3);
    expect(readProgress(dir).options.maxPages).toBe(3);
  });

  it('records failed pages with error and null status, and never refetches them', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/broken') {
        throw new Error('getaddrinfo ENOTFOUND broken');
      }
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/broken']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const first = new Crawler();
    first.configure({ sessionDir: dir, depth: 2 });
    await first.crawl('http://example.com/');

    const records = readRecords(dir);
    expect(records).toHaveLength(2);
    const failure = records.find(
      (r) => r.url === 'http://example.com/broken',
    )!;
    expect(failure.status).toBeNull();
    expect(failure.error).toBe('getaddrinfo ENOTFOUND broken');
    expect(failure.contentFingerprint).toBeNull();
    expect(failure.depth).toBe(1);
    expect(failure.referer).toBe('http://example.com/');

    // Resume: the failed URL is not requested again.
    mockedMakeRequest.mockClear();
    const second = new Crawler();
    second.configure({ sessionDir: dir, depth: 2 });
    const urls = await second.crawl('http://example.com/');
    expect(urls).toEqual([]);
    expect(mockedMakeRequest).not.toHaveBeenCalled();
    expect(readRecords(dir)).toHaveLength(2);
  });

  it('leaves contentFingerprint empty for binary pages', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/img.png']);
      }
      if (opts.url === 'http://example.com/img.png') {
        return binaryResponse(opts.url);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const crawler = new Crawler();
    crawler.configure({ sessionDir: dir, depth: 2 });
    await crawler.crawl('http://example.com/');

    const records = readRecords(dir);
    const img = records.find((r) => r.url === 'http://example.com/img.png')!;
    expect(img.status).toBe(200);
    expect(img.contentFingerprint).toBeNull();
    const root = records.find((r) => r.url === 'http://example.com/')!;
    expect(root.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reconciles records with a stale progress.json left by a crash', async () => {
    // Simulate a crash between appending the record and saving progress:
    // the record for / is on disk, but progress.json still has it queued.
    writeFileSync(
      join(dir, 'records.jsonl'),
      JSON.stringify({
        url: 'http://example.com/',
        status: 200,
        depth: 2,
        referer: '',
        fetchedAt: '2026-11-15T00:00:00.000Z',
        contentFingerprint: 'abc',
        error: null,
      }) + '\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'progress.json'),
      JSON.stringify({
        version: 1,
        options: { depth: 2 },
        pageCount: 0,
        visitedUrls: [],
        crawledUrls: [],
        queue: [{ url: 'http://example.com/', depth: 2, referer: '' }],
      }),
      'utf8',
    );

    const crawler = new Crawler();
    crawler.configure({ sessionDir: dir, depth: 2 });
    const urls = await crawler.crawl('http://example.com/');

    expect(urls).toEqual([]);
    expect(mockedMakeRequest).not.toHaveBeenCalled();
    // The page count is recovered from the records on disk.
    expect(readProgress(dir).pageCount).toBe(1);
    expect(readRecords(dir)).toHaveLength(1);
  });

  it('keeps every records.jsonl line parseable when stopped mid-crawl', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a', '/b', '/c']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const first = new Crawler();
    first.configure({ sessionDir: dir, depth: 2 });
    let pages = 0;
    first.on('page', () => {
      pages += 1;
      if (pages === 2) first.stop();
    });
    await first.crawl('http://example.com/');

    // Every line is a complete, parseable JSON object.
    const lines = readFileSync(join(dir, 'records.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // A new process finishes the rest without refetching recorded pages.
    mockedMakeRequest.mockClear();
    const second = new Crawler();
    second.configure({ sessionDir: dir, depth: 2 });
    const urls = await second.crawl('http://example.com/');

    const recorded = new Set(readRecords(dir).map((r) => r.url));
    expect(recorded.size).toBe(4);
    for (const url of urls) {
      expect(mockedMakeRequest.mock.calls.some((c) => c[0].url === url)).toBe(
        true,
      );
    }
    // No URL was fetched twice across the whole session.
    expect(recorded.size).toBe(
      readRecords(dir).length,
    );
  });

  it('behaves exactly as before when sessionDir is not set', async () => {
    mockedMakeRequest.mockImplementation(async (opts) => {
      if (opts.url === 'http://example.com/') {
        return linksPage(opts.url, ['/a']);
      }
      return htmlResponse(opts.url, '<html><body>Leaf</body></html>');
    });

    const crawler = new Crawler();
    crawler.configure({ depth: 2 });
    const urls = await crawler.crawl('http://example.com/');
    expect(urls).toEqual(['http://example.com/', 'http://example.com/a']);

    // Nothing is persisted anywhere.
    expect(existsSync(join(dir, 'progress.json'))).toBe(false);
    expect(existsSync(join(dir, 'records.jsonl'))).toBe(false);

    // A fresh crawler without sessionDir re-fetches everything.
    mockedMakeRequest.mockClear();
    const other = new Crawler();
    other.configure({ depth: 2 });
    const again = await other.crawl('http://example.com/');
    expect(again).toEqual(['http://example.com/', 'http://example.com/a']);
    expect(mockedMakeRequest).toHaveBeenCalledTimes(2);
  });
});
