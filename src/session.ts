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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { CrawlerOptions } from './types.js';
import Frontier, {
  FRONTIER_VERSION,
  type FrontierSnapshot,
  type QueueItem,
} from './frontier.js';
import RecordsWriter, {
  contentFingerprint,
  type PageRecord,
} from './records.js';

const PROGRESS_FILE = 'progress.json';
const RECORDS_FILE = 'records.jsonl';

/**
 * Crawl options persisted with the session and restored on resume.
 * Only serializable scalars — function options (shouldCrawl etc.) cannot
 * be persisted and are taken from the current configuration on resume.
 */
const PERSISTED_OPTION_KEYS: (keyof CrawlerOptions)[] = [
  'depth',
  'ignoreRelative',
  'userAgent',
  'maxRequestsPerSecond',
  'maxConcurrentRequests',
  'requestTimeout',
  'maxRetries',
  'retryDelay',
  'maxPages',
  'selector',
  'headers',
  'respectRobotsTxt',
  'debug',
];

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
  private readonly dir: string;
  private readonly records: RecordsWriter;
  private frontier: Frontier = new Frontier();
  private resumed = false;

  constructor(dir: string) {
    this.dir = dir;
    this.records = new RecordsWriter(join(dir, RECORDS_FILE));
  }

  /**
   * Loads existing session state, if any. Returns true when resuming.
   * Reconciles the frontier with records.jsonl so pages whose records
   * reached disk are never fetched again, even if the process died
   * between writing a record and saving the frontier.
   */
  load(): boolean {
    mkdirSync(this.dir, { recursive: true });

    let found = false;
    const progressPath = join(this.dir, PROGRESS_FILE);
    if (existsSync(progressPath)) {
      const snapshot = JSON.parse(
        readFileSync(progressPath, 'utf8'),
      ) as FrontierSnapshot;
      this.frontier = new Frontier(snapshot);
      found = true;
    }

    const records = this.records.readAll();
    if (records.length > 0) {
      found = true;
      let successCount = 0;
      for (const record of records) {
        this.frontier.dequeue(record.url);
        this.frontier.markCrawled(record.url);
        if (record.error === null) successCount++;
      }
      // The page count is at least the number of successful records on
      // disk, even if progress.json was lost or is stale.
      if (successCount > this.frontier.pageCount) {
        this.frontier.pageCount = successCount;
      }
    }

    this.resumed = found;
    return found;
  }

  /** Options persisted with the session (null on a fresh session). */
  get persistedOptions(): Partial<CrawlerOptions> | null {
    return this.resumed ? this.frontier.persistedOptions : null;
  }

  /** Global crawled-page count, accumulated across processes. */
  get pageCount(): number {
    return this.frontier.pageCount;
  }

  /** Starts a fresh session with the given crawl options. */
  startFresh(options: CrawlerOptions): void {
    const persisted: Record<string, unknown> = {};
    for (const key of PERSISTED_OPTION_KEYS) {
      if (options[key] !== undefined) {
        persisted[key] = options[key];
      }
    }
    this.frontier.persistedOptions = persisted as Partial<CrawlerOptions>;
    this.save();
  }

  /**
   * Claims a URL for crawling: adds it to the pending queue and persists
   * the frontier. Returns false when the URL is already known (visited
   * or queued) and must not be fetched again.
   */
  enqueue(url: string, depth: number, referer: string): boolean {
    if (!this.frontier.enqueue(url, depth, referer)) {
      return false;
    }
    this.save();
    return true;
  }

  /**
   * Queued URLs to continue with on resume. Drains the in-memory queue:
   * the crawler is expected to re-claim the items it will actually crawl
   * via enqueue(); anything it rejects (depth, shouldCrawl, maxPages)
   * stays out of the frontier.
   */
  pendingQueue(): QueueItem[] {
    const items = this.frontier.pending();
    for (const item of items) {
      this.frontier.dequeue(item.url);
    }
    return items;
  }

  /** Removes a URL from the queue without recording a page (e.g. robots.txt block). */
  discard(url: string): void {
    this.frontier.dequeue(url);
    this.save();
  }

  /**
   * Records a fetched page: appends to records.jsonl first, then updates
   * and persists the frontier. Record-first ordering plus load-time
   * reconciliation guarantees a page that reached disk is never
   * re-fetched, even if the process dies between the two writes.
   */
  completePage(outcome: PageOutcome): void {
    const record: PageRecord = {
      url: outcome.finalUrl,
      status: outcome.status,
      depth: outcome.depth,
      referer: outcome.referer,
      fetchedAt: new Date().toISOString(),
      contentFingerprint:
        outcome.error === null
          ? contentFingerprint(outcome.body, outcome.isText)
          : null,
      error: outcome.error,
    };
    this.records.append(record);

    this.frontier.dequeue(outcome.requestedUrl);
    this.frontier.markVisited(outcome.visitedUrls);
    this.frontier.markCrawled(outcome.finalUrl);
    if (outcome.error === null) {
      this.frontier.pageCount++;
    }
    this.save();
  }

  /** Persists the final frontier state when a crawl run ends. */
  finish(): void {
    this.save();
  }

  /** Atomically rewrites progress.json (tmp file + rename). */
  private save(): void {
    const snapshot: FrontierSnapshot = {
      ...this.frontier.toSnapshot(),
      version: FRONTIER_VERSION,
    };
    const tmpPath = join(this.dir, `${PROGRESS_FILE}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    renameSync(tmpPath, join(this.dir, PROGRESS_FILE));
  }
}
