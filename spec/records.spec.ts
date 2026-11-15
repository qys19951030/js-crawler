import { describe, it, expect } from 'vitest';
import RecordsWriter, { contentFingerprint } from '../src/records.js';

describe('RecordsWriter (skeleton)', () => {
  it('is defined', () => {
    expect(RecordsWriter).toBeDefined();
    expect(contentFingerprint).toBeDefined();
  });
});
