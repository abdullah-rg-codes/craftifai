export interface ModelUsage {
  total_tokens: number;
}

export interface ModelResponse {
  usage: ModelUsage;
}

export async function callStubModel(input: { max_total_tokens: number }): Promise<ModelResponse> {
  // Deterministic stub: consume between 1 and max_total_tokens, inclusive, with a predictable
  // fraction that exercises the ceiling boundary without being random.
  const actual = Math.max(1, Math.ceil(input.max_total_tokens * 0.6));
  return { usage: { total_tokens: actual } };
}
