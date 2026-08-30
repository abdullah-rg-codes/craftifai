export const APP_NAME = 'craftifai' as const;

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type Role = 'administrator' | 'member';
export type MembershipStatus = 'active' | 'suspended';

export * from './password.js';
export * from './pricing.js';
export * from './errors.js';
export * from './secret.js';
