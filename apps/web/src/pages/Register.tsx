import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, setActiveOrgId } from '../api.js';
import { useAuth } from '../auth.js';
import { pageErrorCopy } from '../errors.js';

export function RegisterPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setActiveOrgId(undefined);
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        }),
      });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Create an organization</h1>
      <p>Registration creates your user, a new organization, and makes you its administrator.</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Display name
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
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
        {error ? (
          <p className="error" role="alert">
            {pageErrorCopy(error)}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
