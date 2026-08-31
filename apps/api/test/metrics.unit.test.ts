import { describe, expect, it } from 'vitest';
import {
  observeCredit,
  observeHttp,
  observeModel,
  observeSweep,
  observeSweepFailure,
  renderMetrics,
} from '../src/metrics.js';

describe('metrics exposition', () => {
  it('renders prometheus counters for HTTP, model, credits, and reconciliation', () => {
    observeHttp({ method: 'GET', path: '/health', status: 200, durationMs: 3 });
    observeModel({ outcome: 'success', durationMs: 12 });
    observeCredit('reserve');
    observeSweep({ acquiredLock: true, expiredReservations: 2 });
    observeSweepFailure();
    const body = renderMetrics();
    expect(body).toContain('craftifai_http_requests_total');
    expect(body).toContain('route="health"');
    expect(body).toContain('craftifai_model_calls_total');
    expect(body).toContain('craftifai_credit_events_total');
    expect(body).toContain('craftifai_reconciliation_expired_reservations_total');
    expect(body).toContain('craftifai_reconciliation_failures_total');
    expect(body).toContain('# TYPE craftifai_http_request_duration_ms histogram');
  });
});
