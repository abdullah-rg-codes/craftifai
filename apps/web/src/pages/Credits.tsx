import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../api.js';
import { PageBody } from '../components/PageState.js';
import { pageErrorCopy } from '../errors.js';

interface LedgerEntry {
  id: string;
  kind: string;
  delta_available: number;
  delta_reserved: number;
  created_at: string;
}

interface Purchase {
  id: string;
  credits: number;
  status: string;
  created_at: string;
}

export function CreditsPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [purchaseCursor, setPurchaseCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [credits, setCredits] = useState('50');

  const load = useCallback(async () => {
    const [ledger, buy] = await Promise.all([
      api<{ entries: LedgerEntry[]; next_cursor: string | null }>('/credits/ledger?limit=20'),
      api<{ purchases: Purchase[]; next_cursor: string | null }>('/purchases?limit=20'),
    ]);
    setEntries(ledger.entries);
    setLedgerCursor(ledger.next_cursor);
    setPurchases(buy.purchases);
    setPurchaseCursor(buy.next_cursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
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

  async function buy(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await api('/purchases', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({ credits: Number.parseInt(credits, 10) }),
      });
      await load();
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <section>
      <h1>Credits</h1>
      <p>
        Starting a purchase does not change the balance. Credits are applied only when the mock
        billing service delivers a signed webhook to <code>POST /billing/webhook</code>. See the
        README for the deliver command.
      </p>
      <form className="row-form" onSubmit={(event) => void buy(event)}>
        <label>
          Credits to buy
          <input
            type="number"
            min={1}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            required
          />
        </label>
        <button type="submit">Start purchase</button>
      </form>
      {actionError ? (
        <p className="error" role="alert">
          {pageErrorCopy(actionError)}
        </p>
      ) : null}

      <h2>Purchases</h2>
      <PageBody
        loading={loading}
        error={error}
        empty={{
          when: purchases.length === 0,
          title: 'No purchases yet',
          body: 'Start a purchase above. The organization balance stays unchanged until a signed billing webhook arrives.',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Credits</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => (
              <tr key={purchase.id}>
                <td>{purchase.credits}</td>
                <td>{purchase.status}</td>
                <td>{new Date(purchase.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {purchaseCursor ? (
          <button
            type="button"
            onClick={() => {
              void api<{ purchases: Purchase[]; next_cursor: string | null }>(
                `/purchases?limit=20&cursor=${encodeURIComponent(purchaseCursor)}`,
              ).then((page) => {
                setPurchases((current) => [...current, ...page.purchases]);
                setPurchaseCursor(page.next_cursor);
              });
            }}
          >
            Load more purchases
          </button>
        ) : null}
      </PageBody>

      <h2>Ledger</h2>
      <PageBody
        loading={false}
        error={null}
        empty={{
          when: !loading && !error && entries.length === 0,
          title: 'Ledger is empty',
          body: 'Purchases, reservations, and settlements will appear here after the first credit movement.',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Available</th>
              <th>Reserved</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.kind}</td>
                <td>{entry.delta_available}</td>
                <td>{entry.delta_reserved}</td>
                <td>{new Date(entry.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ledgerCursor ? (
          <button
            type="button"
            onClick={() => {
              void api<{ entries: LedgerEntry[]; next_cursor: string | null }>(
                `/credits/ledger?limit=20&cursor=${encodeURIComponent(ledgerCursor)}`,
              ).then((page) => {
                setEntries((current) => [...current, ...page.entries]);
                setLedgerCursor(page.next_cursor);
              });
            }}
          >
            Load more ledger entries
          </button>
        ) : null}
      </PageBody>
    </section>
  );
}
