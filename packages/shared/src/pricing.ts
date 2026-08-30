export function calculateCreditsFromTokens(totalTokens: number): number {
  if (!Number.isInteger(totalTokens) || totalTokens < 0) {
    throw new Error('totalTokens must be a non-negative integer');
  }
  return Math.max(1, Math.ceil(totalTokens / 1000));
}
