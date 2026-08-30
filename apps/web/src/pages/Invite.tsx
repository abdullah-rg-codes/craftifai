import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, setActiveOrgId } from '../api.js';
import { useAuth } from '../auth.js';
import { pageErrorCopy } from '../errors.js';

export function InvitePage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await api<{ org_id: string; role: 'administrator' | 'member' }>(
        '/members/invitations/accept',
        { method: 'POST', body: JSON.stringify({ token: token.trim() }) },
      );
      setActiveOrgId(accepted.org_id);
      await refresh();
      navigate(accepted.role === 'administrator' ? '/' : '/playground');
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1>Accept an invitation</h1>
      <p>
        Paste the one-time token from the administrator who invited you. There is no email delivery.
      </p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Invitation token
          <input value={token} onChange={(e) => setToken(e.target.value)} required minLength={32} />
        </label>
        {error ? (
          <p className="error" role="alert">
            {pageErrorCopy(error)}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Accepting…' : 'Join organization'}
        </button>
      </form>
    </section>
  );
}
