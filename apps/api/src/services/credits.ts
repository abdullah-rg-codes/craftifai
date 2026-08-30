import { calculateCreditsFromTokens } from '@craftifai/shared';
import type { OrgDal } from '@craftifai/db';

export interface ReservationResult {
  reservationId: string;
  reservedCredits: number;
  account: {
    available: number;
    reserved: number;
  };
}

export interface SettlementResult {
  reservationId: string;
  settledCredits: number;
  refundedCredits: number;
  account: {
    available: number;
    reserved: number;
  };
}

export interface ReleaseResult {
  reservationId: string;
  releasedCredits: number;
  account: {
    available: number;
    reserved: number;
  };
}

export interface PurchaseResult {
  purchaseId: string;
  credits: number;
  status: 'pending';
}

const DEFAULT_RESERVATION_TTL_SECONDS = 180;

export function createCreditService(dal: OrgDal) {
  return {
    async reserve(input: {
      orgId: string;
      userId: string;
      maxTotalTokens: number;
      reservationTtlSeconds?: number;
    }): Promise<ReservationResult | undefined> {
      const credits = calculateCreditsFromTokens(input.maxTotalTokens);
      await dal.creditAccounts.getOrCreate(input.orgId);
      const account = await dal.creditAccounts.reserve(input.orgId, credits);
      if (!account) {
        return undefined;
      }
      const reservation = await dal.creditReservations.create({
        orgId: input.orgId,
        userId: input.userId,
        reservedCredits: credits,
        maxTotalTokens: input.maxTotalTokens,
        expiresAt: new Date(
          Date.now() + (input.reservationTtlSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS) * 1000,
        ),
      });
      await dal.creditLedger.create({
        orgId: input.orgId,
        kind: 'reservation',
        deltaAvailable: -credits,
        deltaReserved: credits,
        reservationId: reservation.id,
      });
      return {
        reservationId: reservation.id,
        reservedCredits: credits,
        account,
      };
    },

    async settle(input: {
      reservationId: string;
      actualTotalTokens: number;
    }): Promise<SettlementResult | undefined> {
      const reservation = await dal.creditReservations.findByIdForUpdate(input.reservationId);
      if (!reservation || reservation.status !== 'reserved') {
        return undefined;
      }
      const settledCredits = Math.min(
        reservation.reserved_credits,
        calculateCreditsFromTokens(input.actualTotalTokens),
      );
      const updated = await dal.creditReservations.updateToSettled(
        input.reservationId,
        input.actualTotalTokens,
        settledCredits,
      );
      if (!updated) {
        return undefined;
      }
      const refund = reservation.reserved_credits - settledCredits;
      const account = await dal.creditAccounts.settle(
        reservation.org_id,
        reservation.reserved_credits,
        settledCredits,
      );
      await dal.creditLedger.create({
        orgId: reservation.org_id,
        kind: 'settlement',
        deltaAvailable: refund,
        deltaReserved: -reservation.reserved_credits,
        reservationId: reservation.id,
      });
      return {
        reservationId: reservation.id,
        settledCredits,
        refundedCredits: refund,
        account,
      };
    },

    async release(input: { reservationId: string }): Promise<ReleaseResult | undefined> {
      const reservation = await dal.creditReservations.findByIdForUpdate(input.reservationId);
      if (!reservation || reservation.status !== 'reserved') {
        return undefined;
      }
      const updated = await dal.creditReservations.updateToReleased(input.reservationId);
      if (!updated) {
        return undefined;
      }
      const account = await dal.creditAccounts.release(
        reservation.org_id,
        reservation.reserved_credits,
      );
      await dal.creditLedger.create({
        orgId: reservation.org_id,
        kind: 'release',
        deltaAvailable: reservation.reserved_credits,
        deltaReserved: -reservation.reserved_credits,
        reservationId: reservation.id,
      });
      return {
        reservationId: reservation.id,
        releasedCredits: reservation.reserved_credits,
        account,
      };
    },

    async expire(input: { reservationId: string }): Promise<ReleaseResult | undefined> {
      const reservation = await dal.creditReservations.findByIdForUpdate(input.reservationId);
      if (!reservation || reservation.status !== 'reserved') {
        return undefined;
      }
      const updated = await dal.creditReservations.updateToExpired(input.reservationId);
      if (!updated) {
        return undefined;
      }
      const account = await dal.creditAccounts.release(
        reservation.org_id,
        reservation.reserved_credits,
      );
      await dal.creditLedger.create({
        orgId: reservation.org_id,
        kind: 'expiry',
        deltaAvailable: reservation.reserved_credits,
        deltaReserved: -reservation.reserved_credits,
        reservationId: reservation.id,
      });
      return {
        reservationId: reservation.id,
        releasedCredits: reservation.reserved_credits,
        account,
      };
    },

    async createPurchase(input: { orgId: string; credits: number }): Promise<PurchaseResult> {
      await dal.creditAccounts.getOrCreate(input.orgId);
      const purchase = await dal.purchases.create({
        orgId: input.orgId,
        credits: input.credits,
      });
      return {
        purchaseId: purchase.id,
        credits: purchase.credits,
        status: 'pending',
      };
    },

    async applyPurchase(input: {
      purchaseId: string;
      providerEventId: string;
      payloadHash: Buffer;
    }): Promise<{ applied: boolean; purchaseId: string }> {
      const event = await dal.webhookEvents.create({
        providerEventId: input.providerEventId,
        payloadHash: input.payloadHash,
      });
      if (!event) {
        return { applied: false, purchaseId: input.purchaseId };
      }
      const purchase = await dal.purchases.findById(input.purchaseId);
      if (!purchase) {
        return { applied: false, purchaseId: input.purchaseId };
      }
      const completed = await dal.purchases.markCompleted(purchase.id);
      if (!completed) {
        return { applied: false, purchaseId: purchase.id };
      }
      await dal.creditAccounts.addAvailable(purchase.org_id, purchase.credits);
      await dal.creditLedger.create({
        orgId: purchase.org_id,
        kind: 'purchase',
        deltaAvailable: purchase.credits,
        deltaReserved: 0,
        purchaseId: purchase.id,
      });
      await dal.webhookEvents.markProcessed(input.providerEventId);
      return { applied: true, purchaseId: purchase.id };
    },
  };
}

export type CreditService = ReturnType<typeof createCreditService>;
