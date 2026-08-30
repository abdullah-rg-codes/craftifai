import { createOrgDal, withSystemTransactionOnClient, type DatabasePool } from '@craftifai/db';
import type { Logger } from '../logger.js';
import { createCreditService } from './credits.js';

const SWEEPER_ADVISORY_LOCK_ID = 1;
const SWEEP_BATCH_SIZE = 100;

export interface SweeperResult {
  expiredReservations: number;
  staleIdempotencyKeys: number;
  acquiredLock: boolean;
}

export async function runReconciliationSweep(
  pool: DatabasePool,
  logger?: Logger,
): Promise<SweeperResult> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SWEEPER_ADVISORY_LOCK_ID],
    );
    if (!lockResult.rows[0]?.locked) {
      return { expiredReservations: 0, staleIdempotencyKeys: 0, acquiredLock: false };
    }

    let expiredReservations = 0;
    let staleIdempotencyKeys = 0;

    try {
      let reservations = await withSystemTransactionOnClient(client, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.creditReservations.listExpiredReserved(SWEEP_BATCH_SIZE);
      });

      while (reservations.length > 0) {
        for (const reservation of reservations) {
          const released = await withSystemTransactionOnClient(client, async (ctx) => {
            const dal = createOrgDal(ctx);
            const service = createCreditService(dal);
            return service.expire({ reservationId: reservation.id });
          });
          if (released) {
            expiredReservations += 1;
          }
        }
        reservations = await withSystemTransactionOnClient(client, async (ctx) => {
          const dal = createOrgDal(ctx);
          return dal.creditReservations.listExpiredReserved(SWEEP_BATCH_SIZE);
        });
      }

      const now = new Date();
      let staleKeys = await withSystemTransactionOnClient(client, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.idempotencyKeys.listStalePending(now, SWEEP_BATCH_SIZE);
      });

      while (staleKeys.length > 0) {
        for (const key of staleKeys) {
          await withSystemTransactionOnClient(client, async (ctx) => {
            const dal = createOrgDal(ctx);
            const service = createCreditService(dal);
            if (key.reservation_id) {
              await service.release({ reservationId: key.reservation_id });
            }
            await dal.idempotencyKeys.markFailed({
              orgId: key.org_id,
              endpoint: key.endpoint,
              key: key.key,
              responseStatus: 504,
              responseBody: {
                error: {
                  code: 'REQUEST_TIMEOUT',
                  message: 'Idempotency key expired before completion',
                },
              },
            });
          });
          staleIdempotencyKeys += 1;
        }
        staleKeys = await withSystemTransactionOnClient(client, async (ctx) => {
          const dal = createOrgDal(ctx);
          return dal.idempotencyKeys.listStalePending(now, SWEEP_BATCH_SIZE);
        });
      }
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [SWEEPER_ADVISORY_LOCK_ID])
        .catch((error) => {
          logger?.error(
            { error: error instanceof Error ? error.message : String(error) },
            'sweeper unlock failed',
          );
        });
    }

    return { expiredReservations, staleIdempotencyKeys, acquiredLock: true };
  } finally {
    client.release();
  }
}
