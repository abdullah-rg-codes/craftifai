import { describe, expect, it } from 'vitest';
import { AppError } from '@craftifai/shared';
import { signWebhook, verifyWebhook, WEBHOOK_MAX_AGE_SECONDS } from '../src/services/billing.js';

const SECRET = 'unit-test-webhook-secret';

describe('webhook signatures', () => {
  it('accepts a payload signed with the same secret and exact body bytes', () => {
    const signed = signWebhook(
      {
        purchase_id: '11111111-1111-4111-8111-111111111111',
        provider_event_id: 'evt_1',
        credits: 10,
      },
      SECRET,
      1_700_000_000,
    );
    const verified = verifyWebhook(signed.body, signed.signature, SECRET, 1_700_000_000);
    expect(verified).toEqual(signed.payload);
  });

  it('rejects a signature computed over a different body', () => {
    const signed = signWebhook(
      {
        purchase_id: '11111111-1111-4111-8111-111111111111',
        provider_event_id: 'evt_1',
        credits: 10,
      },
      SECRET,
      1_700_000_000,
    );
    expect(() =>
      verifyWebhook(
        JSON.stringify({ ...signed.payload, credits: 99 }),
        signed.signature,
        SECRET,
        1_700_000_000,
      ),
    ).toThrow(AppError);
  });

  it('rejects a stale timestamp after the signature has already been verified', () => {
    const issuedAt = 1_700_000_000;
    const signed = signWebhook(
      {
        purchase_id: '11111111-1111-4111-8111-111111111111',
        provider_event_id: 'evt_stale',
        credits: 10,
      },
      SECRET,
      issuedAt,
    );
    try {
      verifyWebhook(signed.body, signed.signature, SECRET, issuedAt + WEBHOOK_MAX_AGE_SECONDS + 1);
      expect.unreachable('stale webhook should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('WEBHOOK_REPLAY');
    }
  });

  it('rejects a signed payload whose purchase_id is not a UUID', () => {
    const signed = signWebhook(
      {
        purchase_id: '52bb8b1f-0362-4531-9ab0-b3887afc6247%',
        provider_event_id: 'evt_malformed',
        credits: 2,
      },
      SECRET,
      1_700_000_000,
    );
    try {
      verifyWebhook(signed.body, signed.signature, SECRET, 1_700_000_000);
      expect.unreachable('malformed purchase_id should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('WEBHOOK_INVALID');
      expect((error as AppError).status).toBe(400);
    }
  });
});
