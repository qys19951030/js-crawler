import { describe, it, expect } from 'vitest';
import Frontier, { normalizeUrl } from '../src/frontier.js';

describe('Frontier (skeleton)', () => {
  it('is defined', () => {
    expect(Frontier).toBeDefined();
    expect(normalizeUrl).toBeDefined();
  });
});
