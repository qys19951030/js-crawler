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

/**
 * The crawl frontier: visited/crawled URL sets plus the pending queue.
 * Pure in-memory data structure; persistence lives in SessionStore.
 */
export default class Frontier {
  constructor(_snapshot?: FrontierSnapshot) {
    throw new Error('not implemented');
  }

  get pageCount(): number {
    throw new Error('not implemented');
  }

  set pageCount(_value: number) {
    throw new Error('not implemented');
  }

  /** True if the URL is already visited or still queued. */
  isKnown(_url: string): boolean {
    throw new Error('not implemented');
  }

  isVisited(_url: string): boolean {
    throw new Error('not implemented');
  }

  /** Adds a URL to the pending queue (no-op if already known). */
  enqueue(_url: string, _depth: number, _referer: string): boolean {
    throw new Error('not implemented');
  }

  /** Removes a URL from the pending queue. */
  dequeue(_url: string): void {
    throw new Error('not implemented');
  }

  /** Marks URLs as visited (final URL plus any redirect chain URLs). */
  markVisited(_urls: string[]): void {
    throw new Error('not implemented');
  }

  /** Marks a URL as successfully crawled (or terminally failed). */
  markCrawled(_url: string): void {
    throw new Error('not implemented');
  }

  /** All queued items waiting to be crawled. */
  pending(): QueueItem[] {
    throw new Error('not implemented');
  }

  /** Serializes the frontier for persistence. */
  toSnapshot(): FrontierSnapshot {
    throw new Error('not implemented');
  }
}
