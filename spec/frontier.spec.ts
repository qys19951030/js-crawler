import { describe, it, expect } from 'vitest';
import Frontier, { normalizeUrl, FRONTIER_VERSION, type FrontierSnapshot } from '../src/frontier.js';

describe('normalizeUrl', () => {
  it('strips the fragment', () => {
    expect(normalizeUrl('http://example.com/page#section')).toBe(
      'http://example.com/page',
    );
  });

  it('treats fragment variants as the same URL', () => {
    expect(normalizeUrl('http://example.com/p#a')).toBe(
      normalizeUrl('http://example.com/p#b'),
    );
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('http://EXAMPLE.com/Path')).toBe(
      'http://example.com/Path',
    );
  });

  it('keeps the path case-sensitive', () => {
    expect(normalizeUrl('http://example.com/A')).not.toBe(
      normalizeUrl('http://example.com/a'),
    );
  });

  it('adds a trailing slash to bare hosts', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('returns the input unchanged for unparseable URLs', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('Frontier', () => {
  it('starts empty', () => {
    const frontier = new Frontier();
    expect(frontier.pageCount).toBe(0);
    expect(frontier.pending()).toEqual([]);
    expect(frontier.isKnown('http://example.com/')).toBe(false);
  });

  describe('enqueue / dequeue', () => {
    it('queues a URL with its depth and referer', () => {
      const frontier = new Frontier();
      expect(frontier.enqueue('http://example.com/a', 1, 'http://example.com/')).toBe(true);
      expect(frontier.pending()).toEqual([
        { url: 'http://example.com/a', depth: 1, referer: 'http://example.com/' },
      ]);
    });

    it('rejects duplicates and keeps the first depth/referer', () => {
      const frontier = new Frontier();
      frontier.enqueue('http://example.com/a', 1, 'http://example.com/');
      expect(frontier.enqueue('http://example.com/a', 5, 'http://other.com/')).toBe(false);
      expect(frontier.pending()).toEqual([
        { url: 'http://example.com/a', depth: 1, referer: 'http://example.com/' },
      ]);
    });

    it('treats fragment and hostname-case variants as duplicates', () => {
      const frontier = new Frontier();
      frontier.enqueue('http://example.com/a#x', 1, '');
      expect(frontier.enqueue('http://EXAMPLE.com/a#y', 2, '')).toBe(false);
      expect(frontier.pending()).toHaveLength(1);
    });

    it('refuses to enqueue an already visited URL', () => {
      const frontier = new Frontier();
      frontier.markVisited(['http://example.com/a']);
      expect(frontier.enqueue('http://example.com/a', 1, '')).toBe(false);
    });

    it('dequeues a queued URL', () => {
      const frontier = new Frontier();
      frontier.enqueue('http://example.com/a', 1, '');
      frontier.dequeue('http://example.com/a#frag');
      expect(frontier.pending()).toEqual([]);
    });
  });

  describe('visited / crawled', () => {
    it('isKnown covers queued and visited URLs', () => {
      const frontier = new Frontier();
      frontier.enqueue('http://example.com/q', 1, '');
      frontier.markVisited(['http://example.com/v']);
      expect(frontier.isKnown('http://example.com/q')).toBe(true);
      expect(frontier.isKnown('http://example.com/v#f')).toBe(true);
      expect(frontier.isKnown('http://example.com/other')).toBe(false);
    });

    it('markCrawled marks the URL as both visited and crawled', () => {
      const frontier = new Frontier();
      frontier.markCrawled('http://example.com/a');
      expect(frontier.isVisited('http://example.com/a')).toBe(true);
      expect(frontier.isCrawled('http://example.com/a')).toBe(true);
    });

    it('markVisited does not mark as crawled', () => {
      const frontier = new Frontier();
      frontier.markVisited(['http://example.com/a']);
      expect(frontier.isVisited('http://example.com/a')).toBe(true);
      expect(frontier.isCrawled('http://example.com/a')).toBe(false);
    });
  });

  describe('snapshot round-trip', () => {
    it('restores the full frontier state from a snapshot', () => {
      const frontier = new Frontier();
      frontier.persistedOptions = { depth: 3, maxPages: 10 };
      frontier.pageCount = 7;
      frontier.markVisited(['http://example.com/redirect']);
      frontier.markCrawled('http://example.com/');
      frontier.enqueue('http://example.com/next', 2, 'http://example.com/');

      const snapshot = frontier.toSnapshot();
      expect(snapshot.version).toBe(FRONTIER_VERSION);

      const restored = new Frontier(snapshot);
      expect(restored.pageCount).toBe(7);
      expect(restored.persistedOptions).toEqual({ depth: 3, maxPages: 10 });
      expect(restored.isVisited('http://example.com/redirect')).toBe(true);
      expect(restored.isCrawled('http://example.com/')).toBe(true);
      expect(restored.pending()).toEqual([
        { url: 'http://example.com/next', depth: 2, referer: 'http://example.com/' },
      ]);
    });

    it('snapshot is JSON-serializable', () => {
      const frontier = new Frontier();
      frontier.enqueue('http://example.com/a', 1, '');
      const restored = new Frontier(
        JSON.parse(JSON.stringify(frontier.toSnapshot())) as FrontierSnapshot,
      );
      expect(restored.pending()).toEqual(frontier.pending());
    });

    it('normalizes URLs loaded from a snapshot', () => {
      const restored = new Frontier({
        version: FRONTIER_VERSION,
        options: {},
        pageCount: 0,
        visitedUrls: ['http://EXAMPLE.com/a#frag'],
        crawledUrls: [],
        queue: [{ url: 'http://EXAMPLE.com/b#x', depth: 1, referer: '' }],
      });
      expect(restored.isVisited('http://example.com/a')).toBe(true);
      expect(restored.pending()).toEqual([
        { url: 'http://example.com/b', depth: 1, referer: '' },
      ]);
    });
  });
});
