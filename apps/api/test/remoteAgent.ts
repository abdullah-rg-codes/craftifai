export interface TestResponse {
  status: number;
  // Matches SuperTest's Response.body so nested assertions type-check for both agents.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SuperTest uses any here
  body: any;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

type Query = Record<string, string | number>;

class RemoteRequest implements PromiseLike<TestResponse> {
  private readonly headers = new Headers();
  private queryParams: Query = {};
  private payload: unknown;
  private readonly expected: { status?: number; body?: unknown } = {};

  constructor(
    private readonly baseUrl: string,
    private readonly method: string,
    private readonly path: string,
  ) {}

  set(name: string, value: string | readonly string[]): this {
    if (typeof value === 'string') {
      this.headers.set(name, value);
      return this;
    }
    const joined = [...value]
      .map((item) => item.split(';')[0]?.trim())
      .filter((part): part is string => Boolean(part))
      .join('; ');
    this.headers.set(name, joined);
    return this;
  }

  query(params: Query): this {
    this.queryParams = { ...this.queryParams, ...params };
    return this;
  }

  send(body: unknown): this {
    this.payload = body;
    if (!this.headers.has('content-type')) {
      this.headers.set('content-type', 'application/json');
    }
    return this;
  }

  expect(statusOrBody: number | object, body?: object): this {
    if (typeof statusOrBody === 'number') {
      this.expected.status = statusOrBody;
      if (body !== undefined) {
        this.expected.body = body;
      }
    } else {
      this.expected.body = statusOrBody;
    }
    return this;
  }

  then<TResult1 = TestResponse, TResult2 = never>(
    onfulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.perform().then(onfulfilled, onrejected);
  }

  private async perform(): Promise<TestResponse> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${this.path}`);
    for (const [key, value] of Object.entries(this.queryParams)) {
      url.searchParams.set(key, String(value));
    }
    if (!this.headers.has('connection')) {
      this.headers.set('connection', 'close');
    }
    const init: RequestInit = {
      method: this.method,
      headers: this.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    };
    if (this.payload !== undefined && this.method !== 'GET' && this.method !== 'HEAD') {
      init.body = typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = { raw: text };
      }
    }
    const headers: Record<string, string | string[] | undefined> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      headers['set-cookie'] = setCookie;
    }
    const result: TestResponse = {
      status: response.status,
      body,
      text,
      headers,
    };
    if (this.expected.status !== undefined && result.status !== this.expected.status) {
      throw new Error(
        `${this.method} ${url.pathname} expected ${String(this.expected.status)} got ${String(result.status)} ${result.text}`,
      );
    }
    if (this.expected.body !== undefined) {
      const actual = JSON.stringify(result.body);
      const wanted = JSON.stringify(this.expected.body);
      if (actual !== wanted) {
        throw new Error(`${this.method} ${url.pathname} body mismatch: ${actual} !== ${wanted}`);
      }
    }
    return result;
  }
}

export interface ChainableTestRequest extends PromiseLike<TestResponse> {
  set(name: string, value: string | readonly string[]): this;
  query(params: Query): this;
  send(body: unknown): this;
  expect(statusOrBody: number | object, body?: object): this;
}

export interface TestAgent {
  get(path: string): ChainableTestRequest;
  post(path: string): ChainableTestRequest;
  put(path: string): ChainableTestRequest;
  patch(path: string): ChainableTestRequest;
  delete(path: string): ChainableTestRequest;
}

export class RemoteAgent implements TestAgent {
  constructor(private readonly baseUrl: string) {}

  get(path: string): RemoteRequest {
    return new RemoteRequest(this.baseUrl, 'GET', path);
  }

  post(path: string): RemoteRequest {
    return new RemoteRequest(this.baseUrl, 'POST', path);
  }

  put(path: string): RemoteRequest {
    return new RemoteRequest(this.baseUrl, 'PUT', path);
  }

  patch(path: string): RemoteRequest {
    return new RemoteRequest(this.baseUrl, 'PATCH', path);
  }

  delete(path: string): RemoteRequest {
    return new RemoteRequest(this.baseUrl, 'DELETE', path);
  }
}

export function testBaseUrl(): string | undefined {
  return process.env.TEST_BASE_URL;
}

export function mockModelUrl(): string | undefined {
  return process.env.MOCK_MODEL_URL;
}
