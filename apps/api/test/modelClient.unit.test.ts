import { describe, expect, it } from 'vitest';
import { parseModelResponse, ModelCallError } from '../src/services/modelClient.js';

describe('model response validation', () => {
  it('accepts an OpenAI-shaped usage object', () => {
    const parsed = parseModelResponse(
      Buffer.from(
        JSON.stringify({
          usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
        }),
      ),
    );
    expect(parsed.usage.total_tokens).toBe(8);
  });

  it('treats missing usage as malformed so settlement never sees NaN', () => {
    expect(() => parseModelResponse(Buffer.from(JSON.stringify({ choices: [] })))).toThrow(
      ModelCallError,
    );
    try {
      parseModelResponse(Buffer.from(JSON.stringify({ usage: { total_tokens: 'nope' } })));
    } catch (error) {
      expect(error).toBeInstanceOf(ModelCallError);
      expect((error as ModelCallError).failure.kind).toBe('malformed');
    }
  });
});
