import { inspect } from 'node:util';

/**
 * Holds a credential so it cannot appear in JSON, logs, or string coercion.
 * The only way to read the value is `use()`, and that must stay off the
 * request/response path.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  use<T>(fn: (plaintext: string) => T): T {
    return fn(this.#value);
  }

  toJSON(): undefined {
    return undefined;
  }

  toString(): string {
    return '[Redacted]';
  }

  valueOf(): string {
    return '[Redacted]';
  }

  [inspect.custom](): string {
    return '[Redacted]';
  }
}

export function isSecret(value: unknown): value is Secret {
  return value instanceof Secret;
}
