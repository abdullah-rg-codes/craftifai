import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageBody } from '../components/PageState.js';
import { pageErrorCopy } from '../errors.js';
import {
  configToForm,
  modelConfigWritePayload,
  type PublicModelConfig,
} from '../modelConfigForm.js';

export function ModelPage() {
  const [config, setConfig] = useState<PublicModelConfig | null>(null);
  const [form, setForm] = useState(configToForm(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PublicModelConfig>('/model-config')
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setForm(configToForm(next));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err && typeof err === 'object' && 'status' in err && err.status === 404) {
          setConfig(null);
          setForm(configToForm(null));
        } else {
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    const body = modelConfigWritePayload(form);
    try {
      const saved = await api<PublicModelConfig>('/model-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setConfig(saved);
      setForm(configToForm(saved));
      setNotice('Configuration saved. The credential is stored encrypted and is not shown again.');
    } catch (err) {
      setActionError(err);
    }
  }

  async function test() {
    setActionError(null);
    setTestResult(null);
    try {
      const result = await api<{ reachable: boolean; error?: string; message?: string }>(
        '/model-config/test',
        { method: 'POST' },
      );
      setTestResult(
        result.reachable
          ? 'Connection succeeded. No credits were charged.'
          : `Connection failed (${result.error ?? 'unknown'}). No credits were charged.`,
      );
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <section>
      <h1>Model configuration</h1>
      <PageBody loading={loading} error={error} empty={{ when: false, title: '', body: '' }}>
        <form onSubmit={(event) => void save(event)}>
          <label>
            Deployment mode
            <select
              value={form.deployment_mode}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  deployment_mode: e.target.value as 'saas' | 'onprem',
                }))
              }
            >
              <option value="saas">SaaS</option>
              <option value="onprem">On-premises</option>
            </select>
          </label>
          <label>
            Endpoint URL
            <input
              type="url"
              value={form.endpoint_url}
              onChange={(e) => setForm((current) => ({ ...current, endpoint_url: e.target.value }))}
              required
            />
          </label>
          <label>
            Model name
            <input
              value={form.model_name}
              onChange={(e) => setForm((current) => ({ ...current, model_name: e.target.value }))}
              required
            />
          </label>
          <label>
            Timeout (ms)
            <input
              type="number"
              min={1000}
              max={120000}
              value={form.timeout_ms}
              onChange={(e) => setForm((current) => ({ ...current, timeout_ms: e.target.value }))}
              required
            />
          </label>
          <label>
            Credential
            <input
              type="password"
              autoComplete="new-password"
              value={form.credential}
              onChange={(e) => setForm((current) => ({ ...current, credential: e.target.value }))}
              placeholder={
                config?.credential_set
                  ? 'Leave blank to keep the stored credential'
                  : 'Paste the model API key'
              }
            />
          </label>
          <p>
            Credential set: {config?.credential_set ? 'yes' : 'no'}
            {config?.credential_updated_at
              ? ` · last changed ${new Date(config.credential_updated_at).toLocaleString()}`
              : ''}
          </p>
          {actionError ? (
            <p className="error" role="alert">
              {pageErrorCopy(actionError)}
            </p>
          ) : null}
          {notice ? <p className="notice">{notice}</p> : null}
          <div className="actions">
            <button type="submit">Save</button>
            <button type="button" onClick={() => void test()} disabled={!config?.credential_set}>
              Test connection
            </button>
          </div>
        </form>
        {testResult ? <p className="notice">{testResult}</p> : null}
      </PageBody>
    </section>
  );
}
