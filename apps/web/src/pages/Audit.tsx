import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageBody } from '../components/PageState.js';
import { auditActionLabel, auditActorLabel, auditTargetLabel } from '../auditCopy.js';

interface AuditEvent {
  id: string;
  action: string;
  actor_email: string | null;
  target_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (next: string | null, append: boolean) => {
    const query = new URLSearchParams({ limit: '20' });
    if (next) query.set('cursor', next);
    const page = await api<{ events: AuditEvent[]; next_cursor: string | null }>(
      `/audit-events?${query.toString()}`,
    );
    setRows((current) => (append ? [...current, ...page.events] : page.events));
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
      <h1>Audit</h1>
      <PageBody
        loading={loading}
        error={error}
        empty={{
          when: rows.length === 0,
          title: 'No audit events yet',
          body: 'Invites, role changes, model updates, and credit purchases will appear here.',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{auditActionLabel(row.action, row.metadata)}</td>
                <td>{auditActorLabel(row.actor_email)}</td>
                <td>{auditTargetLabel(row.action, row.target_type)}</td>
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
