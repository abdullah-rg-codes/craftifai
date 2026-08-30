export interface ModelUsage {
  total_tokens: number;
}

export interface ModelResponse {
  usage: ModelUsage;
}

export async function callStubModel(input: { max_total_tokens: number }): Promise<ModelResponse> {
  // Stay under one credit-block when the reservation covers more than one, so settle
  // refunds unused reserved credits without introducing randomness.
  const actual = input.max_total_tokens > 1000 ? 500 : input.max_total_tokens;
  return { usage: { total_tokens: actual } };
}
