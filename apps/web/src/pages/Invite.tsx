import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, setActiveOrgId } from '../api.js';
import { useAuth } from '../auth.js';
import { LoadingState } from '../components/PageState.js';
import { pageErrorCopy } from '../errors.js';

export function InvitePage() {
  const { session, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromQuery = params.get('token');
    if (fromQuery) {
      setToken(fromQuery);
    }
  }, [params]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!session) {
        setActiveOrgId(undefined);
      }
      const accepted = await api<{ org_id: string; role: 'administrator' | 'member' }>(
        '/members/invitations/accept',
        {
          method: 'POST',
          body: JSON.stringify(
            session ? { token: token.trim() } : { token: token.trim(), password },
          ),
        },
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

  if (loading) {
    return <LoadingState label="Loading…" />;
  }

  return (
    <div className="auth-card">
      <h1>Join an organization</h1>
      {session ? (
        <p>Paste the one-time token. You are signed in as {session.email}.</p>
      ) : (
        <p>
          Paste the one-time token from the administrator and choose a password. This adds you to
          their organization only — it does not create a new one. Do not use Register.
        </p>
      )}
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Invitation token
          <input value={token} onChange={(e) => setToken(e.target.value)} required minLength={32} />
        </label>
        {session ? null : (
          <label>
            Password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        )}
        {error ? (
          <p className="error" role="alert">
            {pageErrorCopy(error)}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join organization'}
        </button>
      </form>
      {session ? (
        <p>
          <Link to="/">Back</Link>
        </p>
      ) : (
        <p>
          Already have an account? <Link to="/login">Sign in</Link>, then return here.
        </p>
      )}
    </div>
  );
}
