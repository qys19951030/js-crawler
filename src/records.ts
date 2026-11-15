/**
 * Append-only page record log (records.jsonl) for persistent crawl sessions.
 *
 * Each fetched page — successful or failed — is recorded as a single JSON
 * line. Lines are appended with one atomic write so an interrupted process
 * never leaves a half-written line behind.
 */
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * One fetched page, as persisted to records.jsonl.
 */
export interface PageRecord {
  /** Final URL of the page (after redirects). */
  url: string;
  /** HTTP status code, or null when no server response was received. */
  status: number | null;
  /** Remaining depth the URL was queued with when first discovered. */
  depth: number;
  /** Referer the URL was first discovered from ('' for the start URL). */
  referer: string;
  /** ISO-8601 fetch timestamp. */
  fetchedAt: string;
  /** Fingerprint of the decoded text body, null for binary/non-text pages. */
  contentFingerprint: string | null;
  /** Failure reason, null on success. */
  error: string | null;
}

/**
 * Computes the content fingerprint for a decoded page body.
 * Returns null for binary / non-text content.
 */
export function contentFingerprint(body: string, isText: boolean): string | null {
  if (!isText) return null;
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Append-only writer for records.jsonl.
 */
export default class RecordsWriter {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Appends one record as a single JSON line. The whole line goes out in
   * one synchronous write, so a crash mid-write cannot interleave with
   * other appends and previously written lines stay intact.
   */
  append(record: PageRecord): void {
    appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
  }

  /** Reads all records back (used to reconcile state on resume). */
  readAll(): PageRecord[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf8');
    const records: PageRecord[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      records.push(JSON.parse(trimmed) as PageRecord);
    }
    return records;
  }
}
