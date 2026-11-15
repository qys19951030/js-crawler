/**
 * Persistent crawl session.
 *
 * A session lives in a directory (`sessionDir`) holding two files:
 *
 * - `progress.json` — the crawl frontier: visited URLs, crawled URLs,
 *   the pending queue (with remaining depth and referer per URL), the
 *   global crawled-page count, and the crawl options the session was
 *   started with. Rewritten atomically (tmp file + rename) whenever the
 *   frontier changes.
 * - `records.jsonl` — append-only log of fetched pages, one JSON object
 *   per line, written by RecordsWriter. Existing lines are never
 *   rewritten, so resumed sessions keep the full history.
 *
 * Resuming a session: construct a Session on the same directory and call
 * load(). Persisted options take precedence over newly configured ones,
 * recorded pages are treated as already visited (never re-fetched), and
 * queued URLs continue with the depth/referer they were first seen with.
 */
import type { CrawlerOptions } from './types.js';
import type { QueueItem } from './frontier.js';

/** Everything needed to persist one fetched page. */
export interface PageOutcome {
  /** The URL that was requested. */
  requestedUrl: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** All URLs visited along the way (redirect chain + final URL). */
  visitedUrls: string[];
  /** HTTP status, or null when no server response was received. */
  status: number | null;
  /** Remaining depth the URL was queued with. */
  depth: number;
  /** Referer the URL was first discovered from. */
  referer: string;
  /** Decoded text body ('' when unavailable). */
  body: string;
  /** Whether the response was textual content. */
  isText: boolean;
  /** Failure reason, null on success. */
  error: string | null;
}

export default class Session {
  constructor(_dir: string) {
    throw new Error('not implemented');
  }

  /**
   * Loads existing session state, if any. Returns true when resuming.
   * Reconciles the frontier with records.jsonl so pages whose records
   * reached disk are never fetched again.
   */
  load(): boolean {
    throw new Error('not implemented');
  }

  /** Options persisted with the session (null on a fresh session). */
  get persistedOptions(): Partial<CrawlerOptions> | null {
    throw new Error('not implemented');
  }

  /** Global crawled-page count, accumulated across processes. */
  get pageCount(): number {
    throw new Error('not implemented');
  }

  /** Starts a fresh session with the given crawl options. */
  startFresh(_options: Partial<CrawlerOptions>): void {
    throw new Error('not implemented');
  }

  /** True if the URL is already visited or queued (never fetch twice). */
  isKnown(_url: string): boolean {
    throw new Error('not implemented');
  }

  /** Queues a URL discovered during this run and persists the frontier. */
  enqueue(_url: string, _depth: number, _referer: string): void {
    throw new Error('not implemented');
  }

  /** Queued URLs to continue with on resume. */
  pendingQueue(): QueueItem[] {
    throw new Error('not implemented');
  }

  /** Removes a URL from the queue without recording a page (e.g. robots.txt block). */
  discard(_url: string): void {
    throw new Error('not implemented');
  }

  /**
   * Records a fetched page: appends to records.jsonl first, then updates
   * and persists the frontier. Record-first ordering plus load-time
   * reconciliation guarantees a page that reached disk is never
   * re-fetched, even if the process dies between the two writes.
   */
  completePage(_outcome: PageOutcome): void {
    throw new Error('not implemented');
  }

  /** Persists the final frontier state when a crawl run ends. */
  finish(): void {
    throw new Error('not implemented');
  }
}
