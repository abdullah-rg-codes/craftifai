import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageBody } from '../components/PageState.js';

interface Reservation {
  id: string;
  user_id: string;
  status: string;
  reserved_credits: number;
  settled_credits: number | null;
  max_total_tokens: number;
  created_at: string;
}

export function OrgUsagePage() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (next: string | null, append: boolean) => {
    const query = new URLSearchParams({ limit: '20' });
    if (next) query.set('cursor', next);
    const page = await api<{ reservations: Reservation[]; next_cursor: string | null }>(
      `/credits/reservations?${query.toString()}`,
    );
    setRows((current) => (append ? [...current, ...page.reservations] : page.reservations));
    setCursor(page.next_cursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(null, false)
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <section>
      <h1>Organization usage</h1>
      <PageBody
        loading={loading}
        error={error}
        empty={{
          when: rows.length === 0,
          title: 'No inference requests yet',
          body: 'Usage appears after someone in this organization runs a request from the playground.',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Reserved</th>
              <th>Settled</th>
              <th>Max tokens</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td>{row.reserved_credits}</td>
                <td>{row.settled_credits ?? '—'}</td>
                <td>{row.max_total_tokens}</td>
                <td>{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cursor ? (
          <button type="button" onClick={() => void load(cursor, true)}>
            Load more
          </button>
        ) : null}
      </PageBody>
    </section>
  );
}
