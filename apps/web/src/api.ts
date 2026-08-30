const API_PREFIX = '/api';
const ORG_STORAGE_KEY = 'craftifai_org_id';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> | undefined = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setActiveOrgId(orgId: string | undefined): void {
  if (orgId) {
    sessionStorage.setItem(ORG_STORAGE_KEY, orgId);
  } else {
    sessionStorage.removeItem(ORG_STORAGE_KEY);
  }
}

export function getActiveOrgId(): string | undefined {
  return sessionStorage.getItem(ORG_STORAGE_KEY) ?? undefined;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const orgId = getActiveOrgId();
  if (orgId) {
    headers.set('x-org-id', orgId);
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      typeof body === 'object' && body !== null && 'error' in body
        ? (
            body as {
              error?: { code?: string; message?: string; details?: Record<string, unknown> };
            }
          ).error
        : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Request failed',
      error?.details,
    );
  }
  return body as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
