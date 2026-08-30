import { describe, expect, it } from 'vitest';
import { calculateCreditsFromTokens } from '@craftifai/shared';

describe('pricing', () => {
  it.each([
    [0, 1],
    [1, 1],
    [500, 1],
    [999, 1],
    [1000, 1],
    [1001, 2],
    [2800, 3],
    [3000, 3],
    [3001, 4],
  ])('charges %i tokens as %i credits', (tokens, credits) => {
    expect(calculateCreditsFromTokens(tokens)).toBe(credits);
  });

  it('rejects negative token counts', () => {
    expect(() => calculateCreditsFromTokens(-1)).toThrow(
      'totalTokens must be a non-negative integer',
    );
  });

  it('rejects fractional token counts', () => {
    expect(() => calculateCreditsFromTokens(1.5)).toThrow(
      'totalTokens must be a non-negative integer',
    );
  });
});
