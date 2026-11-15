/**
 * Persistent crawl frontier for session-based crawling.
 *
 * Tracks which URLs have been visited, which pages have been crawled,
 * which URLs are still queued (with their remaining depth and referer),
 * the global crawled-page count, and the crawl options the session was
 * started with. The whole frontier is persisted to progress.json inside
 * the session directory so an interrupted crawl can resume later.
 */
import type { CrawlerOptions } from './types.js';

/**
 * Normalizes a URL for deduplication: strips the fragment and
 * lowercases the hostname, so `http://A.com/x#1` and `http://a.com/x`
 * are treated as the same URL.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.href;
  } catch {
    return url;
  }
}

/** A URL still waiting to be crawled, with its original discovery context. */
export interface QueueItem {
  url: string;
  depth: number;
  referer: string;
}

/** Serializable shape of progress.json. */
export interface FrontierSnapshot {
  version: number;
  options: Partial<CrawlerOptions>;
  pageCount: number;
  visitedUrls: string[];
  crawledUrls: string[];
  queue: QueueItem[];
}

export const FRONTIER_VERSION = 1;

/**
 * The crawl frontier: visited/crawled URL sets plus the pending queue.
 * Pure in-memory data structure; persistence lives in Session.
 */
export default class Frontier {
  private visitedUrls: Set<string> = new Set();
  private crawledUrls: Set<string> = new Set();
  private queue: Map<string, QueueItem> = new Map();
  private options: Partial<CrawlerOptions> = {};
  private count = 0;

  constructor(snapshot?: FrontierSnapshot) {
    if (!snapshot) return;
    this.options = snapshot.options ?? {};
    this.count = snapshot.pageCount ?? 0;
    for (const url of snapshot.visitedUrls ?? []) {
      this.visitedUrls.add(normalizeUrl(url));
    }
    for (const url of snapshot.crawledUrls ?? []) {
      this.crawledUrls.add(normalizeUrl(url));
    }
    for (const item of snapshot.queue ?? []) {
      const url = normalizeUrl(item.url);
      this.queue.set(url, { url, depth: item.depth, referer: item.referer });
    }
  }

  get pageCount(): number {
    return this.count;
  }

  set pageCount(value: number) {
    this.count = value;
  }

  get persistedOptions(): Partial<CrawlerOptions> {
    return this.options;
  }

  set persistedOptions(options: Partial<CrawlerOptions>) {
    this.options = options;
  }

  /** True if the URL is already visited or still queued. */
  isKnown(url: string): boolean {
    const normalized = normalizeUrl(url);
    return this.visitedUrls.has(normalized) || this.queue.has(normalized);
  }

  isVisited(url: string): boolean {
    return this.visitedUrls.has(normalizeUrl(url));
  }

  isCrawled(url: string): boolean {
    return this.crawledUrls.has(normalizeUrl(url));
  }

  /**
   * Adds a URL to the pending queue. Returns false (and keeps the
   * original depth/referer) when the URL is already known.
   */
  enqueue(url: string, depth: number, referer: string): boolean {
    const normalized = normalizeUrl(url);
    if (this.visitedUrls.has(normalized) || this.queue.has(normalized)) {
      return false;
    }
    this.queue.set(normalized, { url: normalized, depth, referer });
    return true;
  }

  /** Removes a URL from the pending queue. */
  dequeue(url: string): void {
    this.queue.delete(normalizeUrl(url));
  }

  /** Marks URLs as visited (final URL plus any redirect chain URLs). */
  markVisited(urls: string[]): void {
    for (const url of urls) {
      this.visitedUrls.add(normalizeUrl(url));
    }
  }

  /** Marks a URL as crawled (successfully or terminally failed). */
  markCrawled(url: string): void {
    const normalized = normalizeUrl(url);
    this.visitedUrls.add(normalized);
    this.crawledUrls.add(normalized);
  }

  /** All queued items waiting to be crawled. */
  pending(): QueueItem[] {
    return [...this.queue.values()];
  }

  /** Serializes the frontier for persistence. */
  toSnapshot(): FrontierSnapshot {
    return {
      version: FRONTIER_VERSION,
      options: this.options,
      pageCount: this.count,
      visitedUrls: [...this.visitedUrls],
      crawledUrls: [...this.crawledUrls],
      queue: this.pending(),
    };
  }
}
