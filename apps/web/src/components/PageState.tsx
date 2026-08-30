import type { ReactNode } from 'react';
import { pageErrorCopy } from '../errors.js';

export function LoadingState({ label }: { label: string }) {
  return <p className="state">{label}</p>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="state">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="state error" role="alert">
      <h2>Could not load this page</h2>
      <p>{pageErrorCopy(error)}</p>
    </div>
  );
}

export function PageBody({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: { when: boolean; title: string; body: string };
  children: ReactNode;
}) {
  if (loading) {
    return <LoadingState label="Loading…" />;
  }
  if (error) {
    return <ErrorState error={error} />;
  }
  if (empty.when) {
    return <EmptyState title={empty.title} body={empty.body} />;
  }
  return <>{children}</>;
}
