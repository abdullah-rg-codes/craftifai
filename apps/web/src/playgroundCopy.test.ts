import { describe, expect, it } from 'vitest';
import { playgroundBillingCopy } from './playgroundCopy.js';

describe('playground billing copy', () => {
  it('states tokens and credits in a sentence', () => {
    expect(playgroundBillingCopy(200, 1)).toBe('This run used 200 tokens and charged 1 credit.');
    expect(playgroundBillingCopy(200, 2)).toBe('This run used 200 tokens and charged 2 credits.');
    expect(playgroundBillingCopy(200, undefined)).toBe('This run used 200 tokens.');
    expect(playgroundBillingCopy(undefined, 1)).toBeUndefined();
  });
});
