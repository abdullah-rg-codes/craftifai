import { FormEvent, useState } from 'react';
import { api, newIdempotencyKey } from '../api.js';
import { playgroundErrorCopy } from '../errors.js';
import { playgroundBillingCopy } from '../playgroundCopy.js';
import { useAuth } from '../auth.js';

interface PlaygroundResult {
  completion: string | undefined;
  summary: string | undefined;
}

export function PlaygroundPage() {
  const { session } = useAuth();
  const role = session?.role ?? 'member';
  const [prompt, setPrompt] = useState('Say hello in one sentence.');
  const [maxTokens, setMaxTokens] = useState('200');
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [errorCopy, setErrorCopy] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorCopy(null);
    setResult(null);
    try {
      const response = await api<{
        completion?: string;
        settled_credits?: number;
        usage?: { total_tokens?: number };
      }>('/inference', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_total_tokens: Number.parseInt(maxTokens, 10),
        }),
      });
      setResult({
        completion: response.completion,
        summary: playgroundBillingCopy(response.usage?.total_tokens, response.settled_credits),
      });
    } catch (err) {
      setErrorCopy(playgroundErrorCopy(err, role));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Playground</h1>
      <p>Each run is billed separately. Credits are held before the model runs.</p>
      <form onSubmit={(event) => void run(event)}>
        <label>
          Prompt
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} required />
        </label>
        <label>
          Max total tokens
          <input
            type="number"
            min={1}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </form>
      {errorCopy ? (
        <div className="error" role="alert">
          <strong>{errorCopy.title}</strong>
          <p>{errorCopy.body}</p>
        </div>
      ) : null}
      {result ? (
        <div className="completion">
          {result.completion ? (
            <>
              <p>
                <strong>Model reply</strong>
              </p>
              <pre>{result.completion}</pre>
            </>
          ) : null}
          {result.summary ? <p>{result.summary}</p> : null}
          {!result.completion && !result.summary ? <p>The request completed.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
