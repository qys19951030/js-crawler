/**
 * Append-only page record log (records.jsonl) for persistent crawl sessions.
 *
 * Each fetched page — successful or failed — is recorded as a single JSON
 * line. Lines are appended with one atomic write so an interrupted process
 * never leaves a half-written line behind.
 */

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
export function contentFingerprint(_body: string, _isText: boolean): string | null {
  throw new Error('not implemented');
}

/**
 * Append-only writer for records.jsonl.
 */
export default class RecordsWriter {
  constructor(_filePath: string) {
    throw new Error('not implemented');
  }

  /** Appends one record as a single JSON line. */
  append(_record: PageRecord): void {
    throw new Error('not implemented');
  }

  /** Reads all records back (used to reconcile state on resume). */
  readAll(): PageRecord[] {
    throw new Error('not implemented');
  }
}
