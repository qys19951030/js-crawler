import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import RecordsWriter, { contentFingerprint, type PageRecord } from '../src/records.js';

function makeRecord(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url: 'http://example.com/',
    status: 200,
    depth: 2,
    referer: '',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    contentFingerprint: 'abc123',
    error: null,
    ...overrides,
  };
}

describe('contentFingerprint', () => {
  it('returns a sha256 hex digest for text content', () => {
    const fp = contentFingerprint('<html>Hello</html>', true);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same content', () => {
    expect(contentFingerprint('same body', true)).toBe(
      contentFingerprint('same body', true),
    );
  });

  it('differs for different content', () => {
    expect(contentFingerprint('body A', true)).not.toBe(
      contentFingerprint('body B', true),
    );
  });

  it('returns null for non-text content', () => {
    expect(contentFingerprint('<<binary>>', false)).toBeNull();
  });
});

describe('RecordsWriter', () => {
  let dir: string;
  let file: string;
  let writer: RecordsWriter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'js-crawler-records-'));
    file = join(dir, 'records.jsonl');
    writer = new RecordsWriter(file);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSON object per line', () => {
    writer.append(makeRecord());
    writer.append(makeRecord({ url: 'http://example.com/other', status: 404 }));

    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toEqual(makeRecord());
    expect(JSON.parse(lines[1]).url).toBe('http://example.com/other');
  });

  it('creates the file lazily on first append', () => {
    expect(readFileSyncSafe(file)).toBeNull();
    writer.append(makeRecord());
    expect(readFileSyncSafe(file)).not.toBeNull();
  });

  it('appends without rewriting existing lines', () => {
    writer.append(makeRecord());
    const before = readFileSync(file, 'utf8');

    const other = new RecordsWriter(file);
    other.append(makeRecord({ url: 'http://example.com/second' }));

    const after = readFileSync(file, 'utf8');
    expect(after.startsWith(before)).toBe(true);
  });

  it('readAll returns every appended record in order', () => {
    writer.append(makeRecord({ url: 'http://example.com/a' }));
    writer.append(makeRecord({ url: 'http://example.com/b', error: 'boom', status: null }));

    const records = writer.readAll();
    expect(records).toHaveLength(2);
    expect(records[0].url).toBe('http://example.com/a');
    expect(records[1].error).toBe('boom');
    expect(records[1].status).toBeNull();
  });

  it('readAll returns [] when the file does not exist', () => {
    expect(writer.readAll()).toEqual([]);
  });

  it('readAll tolerates a trailing blank line', () => {
    writer.append(makeRecord());
    writeFileSync(file, readFileSync(file, 'utf8') + '\n', 'utf8');
    expect(writer.readAll()).toHaveLength(1);
  });

  it('round-trips null fields (status, contentFingerprint, error)', () => {
    writer.append(
      makeRecord({ status: null, contentFingerprint: null, error: 'timeout' }),
    );
    const [record] = writer.readAll();
    expect(record.status).toBeNull();
    expect(record.contentFingerprint).toBeNull();
    expect(record.error).toBe('timeout');
  });
});

function readFileSyncSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
