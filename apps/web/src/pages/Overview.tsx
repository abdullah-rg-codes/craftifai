import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.js';
import { PageBody } from '../components/PageState.js';

interface Org {
  id: string;
  name: string;
  created_at: string;
}

interface Account {
  available: number;
  reserved: number;
}

export function OverviewPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Org>('/orgs'), api<Account>('/credits/account')])
      .then(([nextOrg, nextAccount]) => {
        if (!cancelled) {
          setOrg(nextOrg);
          setAccount(nextAccount);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1>Organization</h1>
      <PageBody
        loading={loading}
        error={error}
        empty={{
          when: !org || !account,
          title: 'Organization not found',
          body: 'Sign in again, or ask an administrator to restore your membership.',
        }}
      >
        <dl className="facts">
          <div>
            <dt>Name</dt>
            <dd>{org?.name}</dd>
          </div>
          <div>
            <dt>Available credits</dt>
            <dd>{account?.available}</dd>
          </div>
          <div>
            <dt>Reserved credits</dt>
            <dd>{account?.reserved}</dd>
          </div>
        </dl>
        <p>
          {account && account.available === 0
            ? 'The organization has no available credits. '
            : null}
          <Link to="/credits">Buy credits</Link> or <Link to="/model">configure the model</Link>.
        </p>
      </PageBody>
    </section>
  );
}
