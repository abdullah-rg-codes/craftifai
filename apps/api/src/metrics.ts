import os from 'node:os';

const replica = process.env.HOSTNAME ?? os.hostname();
const HTTP_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

type CounterMap = Map<string, number>;

const counters: CounterMap = new Map();
const histogramCounts: CounterMap = new Map();
const histogramSums: CounterMap = new Map();
const histogramBuckets = new Map<string, number[]>();

function inc(map: CounterMap, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function counterKey(name: string, labels: Record<string, string>): string {
  const encoded = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
  return `${name}{${encoded}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function routeClass(path: string): string {
  const segment = path.split('/').filter(Boolean)[0];
  return segment ?? 'root';
}

export function observeHttp(input: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    replica,
    method: input.method,
    route: routeClass(input.path),
    status: String(input.status),
  };
  inc(counters, counterKey('craftifai_http_requests_total', labels));
  observeHistogram(
    'craftifai_http_request_duration_ms',
    { replica, route: labels.route },
    input.durationMs,
  );
}

export function observeModel(input: { outcome: string; durationMs: number }): void {
  inc(counters, counterKey('craftifai_model_calls_total', { replica, outcome: input.outcome }));
  observeHistogram(
    'craftifai_model_call_duration_ms',
    { replica, outcome: input.outcome },
    input.durationMs,
  );
}

export function observeCredit(kind: 'reserve' | 'settle' | 'release'): void {
  inc(counters, counterKey('craftifai_credit_events_total', { replica, kind }));
}

export function observeSweep(input: { acquiredLock: boolean; expiredReservations: number }): void {
  if (!input.acquiredLock) {
    inc(counters, counterKey('craftifai_reconciliation_lock_miss_total', { replica }));
    return;
  }
  inc(counters, counterKey('craftifai_reconciliation_runs_total', { replica }));
  if (input.expiredReservations > 0) {
    inc(
      counters,
      counterKey('craftifai_reconciliation_expired_reservations_total', { replica }),
      input.expiredReservations,
    );
  }
}

export function observeSweepFailure(): void {
  inc(counters, counterKey('craftifai_reconciliation_failures_total', { replica }));
}

function observeHistogram(name: string, labels: Record<string, string>, value: number): void {
  const key = counterKey(name, labels);
  inc(histogramCounts, key);
  inc(histogramSums, key, value);
  let buckets = histogramBuckets.get(key);
  if (!buckets) {
    buckets = HTTP_BUCKETS_MS.map(() => 0);
    histogramBuckets.set(key, buckets);
  }
  for (let i = 0; i < HTTP_BUCKETS_MS.length; i += 1) {
    const bound = HTTP_BUCKETS_MS[i];
    if (bound !== undefined && value <= bound) {
      buckets[i] = (buckets[i] ?? 0) + 1;
    }
  }
}

export function renderMetrics(): string {
  const lines: string[] = [];
  appendCounter(lines, 'craftifai_http_requests_total', 'HTTP requests', counters);
  appendHistogram(
    lines,
    'craftifai_http_request_duration_ms',
    'HTTP request duration in milliseconds',
  );
  appendCounter(lines, 'craftifai_model_calls_total', 'Outbound model calls', counters);
  appendHistogram(
    lines,
    'craftifai_model_call_duration_ms',
    'Outbound model call duration in milliseconds',
  );
  appendCounter(
    lines,
    'craftifai_credit_events_total',
    'Credit reserve/settle/release events',
    counters,
  );
  appendCounter(
    lines,
    'craftifai_reconciliation_lock_miss_total',
    'Sweeper runs that did not acquire the advisory lock',
    counters,
  );
  appendCounter(
    lines,
    'craftifai_reconciliation_runs_total',
    'Sweeper runs that acquired the lock',
    counters,
  );
  appendCounter(
    lines,
    'craftifai_reconciliation_expired_reservations_total',
    'Reservations expired by the sweeper',
    counters,
  );
  appendCounter(
    lines,
    'craftifai_reconciliation_failures_total',
    'Sweeper runs that threw before completing',
    counters,
  );
  return `${lines.join('\n')}\n`;
}

function appendCounter(lines: string[], name: string, help: string, map: CounterMap): void {
  const rows = [...map.entries()].filter(([key]) => key.startsWith(`${name}{`));
  if (rows.length === 0) {
    return;
  }
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} counter`);
  for (const [key, value] of rows) {
    lines.push(`${key} ${String(value)}`);
  }
}

function appendHistogram(lines: string[], name: string, help: string): void {
  const rows = [...histogramCounts.entries()].filter(([key]) => key.startsWith(`${name}{`));
  if (rows.length === 0) {
    return;
  }
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);
  for (const [key, count] of rows) {
    const labels = key.slice(name.length);
    const buckets = histogramBuckets.get(key) ?? HTTP_BUCKETS_MS.map(() => 0);
    for (let i = 0; i < HTTP_BUCKETS_MS.length; i += 1) {
      const le = HTTP_BUCKETS_MS[i];
      lines.push(
        `${name}_bucket${insertLabel(labels, 'le', String(le))} ${String(buckets[i] ?? 0)}`,
      );
    }
    lines.push(`${name}_bucket${insertLabel(labels, 'le', '+Inf')} ${String(count)}`);
    lines.push(`${name}_sum${labels} ${String(histogramSums.get(key) ?? 0)}`);
    lines.push(`${name}_count${labels} ${String(count)}`);
  }
}

function insertLabel(braceLabels: string, name: string, value: string): string {
  const inner = braceLabels.slice(1, -1);
  const next = inner.length > 0 ? `${inner},${name}="${value}"` : `${name}="${value}"`;
  return `{${next}}`;
}
