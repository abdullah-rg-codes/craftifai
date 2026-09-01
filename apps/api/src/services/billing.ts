import { createHmac, timingSafeEqual } from 'node:crypto';
import { webhookInvalid, webhookReplay } from '@craftifai/shared';

export const WEBHOOK_SIGNATURE_SCHEME = 'v1';
export const WEBHOOK_MAX_AGE_SECONDS = 300;

export interface WebhookPayload {
  purchase_id: string;
  provider_event_id: string;
  credits: number;
  timestamp: number;
}

export interface SignedWebhook {
  payload: WebhookPayload;
  signature: string;
  body: string;
}

export function signWebhook(
  payload: Omit<WebhookPayload, 'timestamp'> & { timestamp?: number },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignedWebhook {
  const signed: WebhookPayload = {
    purchase_id: payload.purchase_id,
    provider_event_id: payload.provider_event_id,
    credits: payload.credits,
    timestamp: nowSeconds,
  };
  const body = JSON.stringify(signed);
  const signature = createHmac('sha256', secret).update(`${nowSeconds}.${body}`).digest('hex');
  return {
    payload: signed,
    signature: `t=${nowSeconds},${WEBHOOK_SIGNATURE_SCHEME}=${signature}`,
    body,
  };
}

export function verifyWebhook(
  body: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WebhookPayload {
  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signaturePart = parts.find((part) => part.startsWith(`${WEBHOOK_SIGNATURE_SCHEME}=`));

  if (!timestampPart || !signaturePart) {
    throw webhookInvalid('Missing timestamp or signature');
  }

  const timestamp = Number.parseInt(timestampPart.slice(2), 10);
  if (!Number.isFinite(timestamp)) {
    throw webhookInvalid('Invalid timestamp');
  }

  const receivedSignature = signaturePart.slice(WEBHOOK_SIGNATURE_SCHEME.length + 1);
  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))
  ) {
    throw webhookInvalid('Invalid signature');
  }

  if (nowSeconds - timestamp > WEBHOOK_MAX_AGE_SECONDS) {
    throw webhookReplay('Webhook timestamp too old');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw webhookInvalid('Invalid JSON body');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as WebhookPayload).purchase_id !== 'string' ||
    typeof (payload as WebhookPayload).provider_event_id !== 'string' ||
    typeof (payload as WebhookPayload).credits !== 'number' ||
    typeof (payload as WebhookPayload).timestamp !== 'number'
  ) {
    throw webhookInvalid('Malformed webhook payload');
  }

  const purchaseId = (payload as WebhookPayload).purchase_id;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)
  ) {
    throw webhookInvalid('Malformed webhook payload');
  }

  return payload as WebhookPayload;
}
