export function playgroundBillingCopy(
  totalTokens: number | undefined,
  settledCredits: number | undefined,
): string | undefined {
  if (totalTokens === undefined) {
    return undefined;
  }
  if (settledCredits === undefined) {
    return `This run used ${String(totalTokens)} tokens.`;
  }
  const creditWord = settledCredits === 1 ? 'credit' : 'credits';
  return `This run used ${String(totalTokens)} tokens and charged ${String(settledCredits)} ${creditWord}.`;
}
