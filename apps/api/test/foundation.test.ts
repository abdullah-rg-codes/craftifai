import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { withTransaction, withSystemTransaction, createSystemDal, createPool } from '@craftifai/db';
import {
  hasTestDatabase,
  hasTestRedis,
  runMigrations,
  createTestApp,
  truncateTables,
  directCreateUser,
  directAddMember,
  registerAndLogin,
  login,
  getCookies,
} from './helpers.js';
import { TestResponse } from './remoteAgent.js';

const enabled = hasTestDatabase() && hasTestRedis();
const describeIf = enabled ? describe : describe.skip;

describeIf('Phase 1 foundation', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let pool: ReturnType<typeof createTestApp>['pool'];
  let adminPool: ReturnType<typeof createTestApp>['adminPool'];
  let redis: ReturnType<typeof createTestApp>['redis'];

  beforeAll(async () => {
    const testApp = createTestApp();
    app = testApp.app;
    pool = testApp.pool;
    adminPool = testApp.adminPool;
    redis = testApp.redis;
    runMigrations();
    await withSystemTransaction(pool, async (ctx) => {
      const role = await ctx.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls
           FROM pg_roles
          WHERE rolname = current_user`,
      );
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });

  beforeEach(async () => {
    await truncateTables(adminPool, redis);
  });

  afterAll(async () => {
    await redis.quit();
    await pool.end();
    await adminPool.end();
  });

  it('reports liveness independently and readiness only when PostgreSQL and Redis respond', async () => {
    const health = await app.get('/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(health.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const ready = await app.get('/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready' });
  });

  it('forces RLS on every tenant table and keeps ledger and audit append-only', async () => {
    await withSystemTransaction(pool, async (ctx) => {
      const rls = await ctx.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = ANY($1::text[])
          ORDER BY relname`,
        [
          [
            'organizations',
            'memberships',
            'invitations',
            'org_credit_accounts',
            'credit_ledger',
            'credit_reservations',
            'purchases',
            'idempotency_keys',
            'model_configurations',
            'audit_events',
          ],
        ],
      );
      expect(rls.rows).toHaveLength(10);
      expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const privileges = await ctx.query<{
        ledger_update: boolean;
        ledger_delete: boolean;
        audit_update: boolean;
        audit_delete: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, 'credit_ledger', 'UPDATE') AS ledger_update,
           has_table_privilege(current_user, 'credit_ledger', 'DELETE') AS ledger_delete,
           has_table_privilege(current_user, 'audit_events', 'UPDATE') AS audit_update,
           has_table_privilege(current_user, 'audit_events', 'DELETE') AS audit_delete`,
      );
      expect(privileges.rows[0]).toEqual({
        ledger_update: false,
        ledger_delete: false,
        audit_update: false,
        audit_delete: false,
      });

      const auditForeignKeys = await ctx.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype
           FROM pg_constraint
          WHERE conrelid = 'audit_events'::regclass
            AND contype = 'f'
          ORDER BY conname`,
      );
      expect(auditForeignKeys.rows).toEqual([
        { conname: 'audit_events_actor_user_id_fkey', confdeltype: 'r' },
        { conname: 'audit_events_org_id_fkey', confdeltype: 'r' },
      ]);
    });
  });

  it('tenant isolation: org A context cannot see org B resources by direct id', async () => {
    const orgA = await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      return dal.organizations.create('Org A');
    });
    const orgB = await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      return dal.organizations.create('Org B');
    });
    const userA = await directCreateUser(pool, 'a@example.com');
    const userB = await directCreateUser(pool, 'b@example.com');
    await directAddMember(pool, orgA.id, userA.id, 'administrator');
    const membershipB = await directAddMember(pool, orgB.id, userB.id, 'administrator');
    const resources = await withSystemTransaction(pool, async (ctx) => {
      const invitation = await ctx.query<{ id: string }>(
        `INSERT INTO invitations
          (org_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, 'member', $3, $4, now() + interval '1 day')
         RETURNING id`,
        [orgB.id, 'invite-b@example.com', 'invite-token-hash', userB.id],
      );
      await ctx.query(
        'INSERT INTO org_credit_accounts (org_id, available, reserved) VALUES ($1, 10, 0)',
        [orgB.id],
      );
      const ledger = await ctx.query<{ id: string }>(
        `INSERT INTO credit_ledger
          (org_id, kind, delta_available, delta_reserved)
         VALUES ($1, 'purchase', 10, 0)
         RETURNING id`,
        [orgB.id],
      );
      const reservation = await ctx.query<{ id: string }>(
        `INSERT INTO credit_reservations
          (org_id, user_id, status, reserved_credits, max_total_tokens, expires_at)
         VALUES ($1, $2, 'reserved', 1, 1000, now() + interval '5 minutes')
         RETURNING id`,
        [orgB.id, userB.id],
      );
      const purchase = await ctx.query<{ id: string }>(
        `INSERT INTO purchases (org_id, credits) VALUES ($1, 10) RETURNING id`,
        [orgB.id],
      );
      await ctx.query(
        `INSERT INTO idempotency_keys
          (org_id, endpoint, key, request_fingerprint, expires_at)
         VALUES ($1, 'inference', 'tenant-test-key', $2, now() + interval '1 day')`,
        [orgB.id, 'fingerprint'],
      );
      await ctx.query(
        `INSERT INTO model_configurations (org_id, endpoint_url, model_name)
         VALUES ($1, 'http://model.internal', 'test-model')`,
        [orgB.id],
      );
      const audit = await ctx.query<{ id: string }>(
        `INSERT INTO audit_events (org_id, actor_user_id, action)
         VALUES ($1, $2, 'tenant.test')
         RETURNING id`,
        [orgB.id, userB.id],
      );
      return {
        invitationId: invitation.rows[0]!.id,
        ledgerId: ledger.rows[0]!.id,
        reservationId: reservation.rows[0]!.id,
        purchaseId: purchase.rows[0]!.id,
        auditId: audit.rows[0]!.id,
      };
    });

    await withTransaction(pool, orgA.id, async (ctx) => {
      const targets = [
        { table: 'organizations', predicate: 'id = $1', params: [orgB.id], update: 'name = name' },
        {
          table: 'memberships',
          predicate: 'id = $1',
          params: [membershipB.id],
          update: 'org_id = org_id',
        },
        {
          table: 'invitations',
          predicate: 'id = $1',
          params: [resources.invitationId],
          update: 'org_id = org_id',
        },
        {
          table: 'org_credit_accounts',
          predicate: 'org_id = $1',
          params: [orgB.id],
          update: 'org_id = org_id',
        },
        {
          table: 'credit_ledger',
          predicate: 'id = $1',
          params: [resources.ledgerId],
          update: 'org_id = org_id',
          immutable: true,
        },
        {
          table: 'credit_reservations',
          predicate: 'id = $1',
          params: [resources.reservationId],
          update: 'org_id = org_id',
        },
        {
          table: 'purchases',
          predicate: 'id = $1',
          params: [resources.purchaseId],
          update: 'org_id = org_id',
        },
        {
          table: 'idempotency_keys',
          predicate: "org_id = $1 AND endpoint = 'inference' AND key = 'tenant-test-key'",
          params: [orgB.id],
          update: 'org_id = org_id',
        },
        {
          table: 'model_configurations',
          predicate: 'org_id = $1',
          params: [orgB.id],
          update: 'org_id = org_id',
        },
        {
          table: 'audit_events',
          predicate: 'id = $1',
          params: [resources.auditId],
          update: 'org_id = org_id',
          immutable: true,
        },
      ] as const;

      for (const target of targets) {
        const read = await ctx.query(`SELECT 1 FROM ${target.table} WHERE ${target.predicate}`, [
          ...target.params,
        ]);
        expect(read.rowCount, `${target.table} read leaked`).toBe(0);
        if (!('immutable' in target)) {
          const update = await ctx.query(
            `UPDATE ${target.table} SET ${target.update} WHERE ${target.predicate}`,
            [...target.params],
          );
          const deletion = await ctx.query(
            `DELETE FROM ${target.table} WHERE ${target.predicate}`,
            [...target.params],
          );
          expect(update.rowCount, `${target.table} update leaked`).toBe(0);
          expect(deletion.rowCount, `${target.table} delete leaked`).toBe(0);
        }
      }
    });

    for (const table of ['credit_ledger', 'audit_events']) {
      await expect(
        withTransaction(pool, orgA.id, (ctx) => ctx.query(`DELETE FROM ${table}`)),
      ).rejects.toMatchObject({ code: '42501' });
    }

    const singleConnectionPool = createPool({ max: 1 });
    try {
      await withSystemTransaction(singleConnectionPool, async (ctx) => {
        expect(await createSystemDal(ctx).organizations.findById(orgB.id)).toBeDefined();
      });
      await withTransaction(singleConnectionPool, orgA.id, async (ctx) => {
        expect(
          (await ctx.query('SELECT 1 FROM organizations WHERE id = $1', [orgB.id])).rowCount,
        ).toBe(0);
      });
    } finally {
      await singleConnectionPool.end();
    }

    // API layer: using user A's session with an org B header should not authenticate into org B.
    const { cookie } = await registerAndLogin(app, 'api-a@example.com');
    await app.get('/orgs').set('Cookie', cookie).set('X-Org-Id', orgB.id).expect(404);
    await app
      .patch(`/members/${membershipB.id}/role`)
      .set('Cookie', cookie)
      .send({ role: 'member' })
      .expect(404);
    await app
      .patch(`/members/${membershipB.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'suspended' })
      .expect(404);
    await app.delete(`/members/${membershipB.id}`).set('Cookie', cookie).expect(404);

    const cookieA = await login(app, userA.email, userA.password);

    const ledger = await app.get('/credits/ledger').set('Cookie', cookieA).expect(200);
    expect(ledger.body.entries.map((entry: { id: string }) => entry.id)).not.toContain(
      resources.ledgerId,
    );
    const purchases = await app.get('/purchases').set('Cookie', cookieA).expect(200);
    expect(purchases.body.purchases.map((row: { id: string }) => row.id)).not.toContain(
      resources.purchaseId,
    );
    const reservations = await app.get('/credits/reservations').set('Cookie', cookieA).expect(200);
    expect(reservations.body.reservations.map((row: { id: string }) => row.id)).not.toContain(
      resources.reservationId,
    );
    const audit = await app.get('/audit-events').set('Cookie', cookieA).expect(200);
    expect(audit.body.events.map((event: { id: string }) => event.id)).not.toContain(
      resources.auditId,
    );
    const account = await app.get('/credits/account').set('Cookie', cookieA).expect(200);
    expect(account.body.org_id).toBe(orgA.id);
    const config = await app.get('/model-config').set('Cookie', cookieA).expect(404);
    expect(JSON.stringify(config.body)).not.toContain('http://model.internal');

    await app.get('/credits/ledger').set('Cookie', cookieA).set('X-Org-Id', orgB.id).expect(404);
    await app.get('/credits/account').set('Cookie', cookieA).set('X-Org-Id', orgB.id).expect(404);
    await app
      .get('/credits/reservations')
      .set('Cookie', cookieA)
      .set('X-Org-Id', orgB.id)
      .expect(404);
    await app.get('/purchases').set('Cookie', cookieA).set('X-Org-Id', orgB.id).expect(404);
    await app.get('/audit-events').set('Cookie', cookieA).set('X-Org-Id', orgB.id).expect(404);
    await app.get('/model-config').set('Cookie', cookieA).set('X-Org-Id', orgB.id).expect(404);
  });

  it('registration atomically creates an organization, active admin, and zero balance', async () => {
    const response = await app
      .post('/auth/register')
      .send({ email: 'Owner@Example.com', password: 'password123', display_name: 'Owner' })
      .expect(201);

    await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      const user = await dal.users.findByEmail('owner@example.com');
      expect(user).toMatchObject({
        id: response.body.user_id,
        email: 'Owner@Example.com',
        display_name: 'Owner',
      });
      const membership = await dal.memberships.findByOrgAndUser(
        response.body.org_id as string,
        response.body.user_id as string,
      );
      expect(membership).toMatchObject({ role: 'administrator', status: 'active' });
      const account = await ctx.query<{ available: string; reserved: string }>(
        'SELECT available::text, reserved::text FROM org_credit_accounts WHERE org_id = $1',
        [response.body.org_id],
      );
      expect(account.rows[0]).toEqual({ available: '0', reserved: '0' });
    });

    await app
      .post('/auth/register')
      .send({ email: 'owner@example.com', password: 'different-password' })
      .expect(409);
  });

  it('login is case-insensitive, rejects invalid credentials generically, and logout revokes only that session', async () => {
    await registerAndLogin(app, 'login@example.com');
    const first = await app
      .post('/auth/login')
      .send({ email: 'LOGIN@example.com', password: 'password123' })
      .expect(200);
    const second = await app
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'password123' })
      .expect(200);
    const firstCookie = getCookies(first);
    const secondCookie = getCookies(second);

    const badPassword = await app
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'wrong' })
      .expect(401);
    const unknownUser = await app
      .post('/auth/login')
      .send({ email: 'unknown@example.com', password: 'wrong' })
      .expect(401);
    expect(badPassword.body).toEqual(unknownUser.body);

    await app.post('/auth/logout').set('Cookie', firstCookie).expect(204);
    await app.get('/auth/me').set('Cookie', firstCookie).expect(401);
    await app.get('/auth/me').set('Cookie', secondCookie).expect(200);
  });

  it('session revocation: suspending a user invalidates active sessions deterministically', async () => {
    const admin = await registerAndLogin(app, 'admin@example.com');
    const member = await directCreateUser(pool, 'member@example.com');
    await directAddMember(pool, admin.orgId, member.id, 'member');

    const cookie = await login(app, 'member@example.com', 'password123');

    await app
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200)
      .then((res) => expect(res.body.user_id).toBe(member.id));

    const memberMembershipId = await getMembershipId(pool, admin.orgId, member.id);
    await app
      .patch(`/members/${memberMembershipId}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'suspended' })
      .expect(204);

    await app.get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('supports promote, demote, suspend, reactivate, and remove with audit records', async () => {
    const admin = await registerAndLogin(app, 'lifecycle-admin@example.com');
    const member = await directCreateUser(pool, 'lifecycle-member@example.com');
    const membership = await directAddMember(pool, admin.orgId, member.id);
    const originalCookie = await login(app, member.email, member.password);

    await app
      .patch(`/members/${membership.id}/role`)
      .set('Cookie', admin.cookie)
      .send({ role: 'administrator' })
      .expect(204);
    await app
      .patch(`/members/${membership.id}/role`)
      .set('Cookie', admin.cookie)
      .send({ role: 'member' })
      .expect(204);
    await app
      .patch(`/members/${membership.id}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'suspended' })
      .expect(204);
    await app.get('/auth/me').set('Cookie', originalCookie).expect(401);
    await app
      .patch(`/members/${membership.id}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'active' })
      .expect(204);
    const reactivatedCookie = await login(app, member.email, member.password);
    await app.delete(`/members/${membership.id}`).set('Cookie', admin.cookie).expect(204);
    await app.get('/auth/me').set('Cookie', reactivatedCookie).expect(401);

    await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      expect(await dal.memberships.findById(membership.id)).toBeUndefined();
      const events = await ctx.query<{ action: string }>(
        `SELECT action FROM audit_events
          WHERE org_id = $1 AND target_id = $2
          ORDER BY created_at, id`,
        [admin.orgId, membership.id],
      );
      expect(events.rows.map((event) => event.action)).toEqual([
        'membership.role.update',
        'membership.role.update',
        'membership.status.update',
        'membership.status.update',
        'membership.delete',
      ]);
    });
  });

  it.each([
    {
      operation: 'demotions',
      request: (membershipId: string, cookie: string[]) =>
        app.patch(`/members/${membershipId}/role`).set('Cookie', cookie).send({ role: 'member' }),
    },
    {
      operation: 'suspensions',
      request: (membershipId: string, cookie: string[]) =>
        app
          .patch(`/members/${membershipId}/status`)
          .set('Cookie', cookie)
          .send({ status: 'suspended' }),
    },
    {
      operation: 'removals',
      request: (membershipId: string, cookie: string[]) =>
        app.delete(`/members/${membershipId}`).set('Cookie', cookie),
    },
  ])('allows exactly one of two concurrent administrator $operation', async ({ request }) => {
    const org = await withSystemTransaction(pool, async (ctx) => {
      return createSystemDal(ctx).organizations.create('Concurrent org');
    });
    const admin1 = await directCreateUser(pool, 'admin1@example.com');
    const admin2 = await directCreateUser(pool, 'admin2@example.com');
    await directAddMember(pool, org.id, admin1.id, 'administrator');
    await directAddMember(pool, org.id, admin2.id, 'administrator');
    const cookie1 = await login(app, admin1.email, admin1.password);
    const cookie2 = await login(app, admin2.email, admin2.password);
    const m1 = await getMembershipId(pool, org.id, admin1.id);
    const m2 = await getMembershipId(pool, org.id, admin2.id);

    const blocker = await adminPool.connect();
    let requests: Promise<[TestResponse, TestResponse]> | undefined;
    let blockedCount = 0;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [org.id]);
      requests = Promise.all([request(m1, cookie1), request(m2, cookie2)]);

      const deadline = Date.now() + 5000;
      while (blockedCount < 2 && Date.now() < deadline) {
        blockedCount = await withSystemTransaction(adminPool, async (ctx) => {
          const result = await ctx.query<{ count: string }>(
            `SELECT count(*)::text AS count
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND cardinality(pg_blocking_pids(pid)) > 0`,
          );
          return Number.parseInt(result.rows[0]?.count ?? '0', 10);
        });
        if (blockedCount < 2) {
          await delay(10);
        }
      }
      await blocker.query('COMMIT');
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }

    if (!requests) {
      throw new Error('Concurrent requests were not started');
    }
    const [r1, r2] = await requests;

    expect(
      blockedCount,
      'both mutations must wait on the organization row lock',
    ).toBeGreaterThanOrEqual(2);
    expect([r1.status, r2.status].sort()).toEqual([204, 403]);
    const activeAdmins = await withSystemTransaction(pool, async (ctx) => {
      return createSystemDal(ctx).memberships.countActiveAdmins(org.id);
    });
    expect(activeAdmins).toBe(1);
  });

  it.each([
    {
      operation: 'demote',
      request: (membershipId: string, cookie: string[]) =>
        app.patch(`/members/${membershipId}/role`).set('Cookie', cookie).send({ role: 'member' }),
    },
    {
      operation: 'suspend',
      request: (membershipId: string, cookie: string[]) =>
        app
          .patch(`/members/${membershipId}/status`)
          .set('Cookie', cookie)
          .send({ status: 'suspended' }),
    },
    {
      operation: 'remove',
      request: (membershipId: string, cookie: string[]) =>
        app.delete(`/members/${membershipId}`).set('Cookie', cookie),
    },
  ])('blocks an attempt to $operation the final active administrator', async ({ request }) => {
    const admin = await registerAndLogin(app, 'only-admin@example.com');
    const membershipId = await getMembershipId(pool, admin.orgId, admin.userId);

    await request(membershipId, admin.cookie).expect(403);

    const membership = await withSystemTransaction(pool, async (ctx) => {
      return createSystemDal(ctx).memberships.findById(membershipId);
    });
    expect(membership).toMatchObject({ role: 'administrator', status: 'active' });
  });

  it('member cannot call administrative endpoints', async () => {
    const admin = await registerAndLogin(app, 'admin@example.com');
    const member = await directCreateUser(pool, 'member@example.com');
    await directAddMember(pool, admin.orgId, member.id, 'member');
    const cookie = await login(app, 'member@example.com', 'password123');

    await app.get('/members').set('Cookie', cookie).expect(403);
    await app
      .post('/members/invitations')
      .set('Cookie', cookie)
      .send({ email: 'invite@example.com', role: 'member' })
      .expect(403);
    const membershipId = await getMembershipId(pool, admin.orgId, member.id);
    await app
      .patch(`/members/${membershipId}/role`)
      .set('Cookie', cookie)
      .send({ role: 'administrator' })
      .expect(403);
    await app
      .patch(`/members/${membershipId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'suspended' })
      .expect(403);
    await app.delete(`/members/${membershipId}`).set('Cookie', cookie).expect(403);
    await app.get('/audit-events').set('Cookie', cookie).expect(403);

    await app.get('/credits/account').set('Cookie', cookie).expect(403);
    await app.get('/credits/ledger').set('Cookie', cookie).expect(403);
    await app.get('/credits/reservations').set('Cookie', cookie).expect(403);
    await app.get('/purchases').set('Cookie', cookie).expect(403);
    await app
      .post('/purchases')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'member-purchase')
      .send({ credits: 10 })
      .expect(403);
    await app.get('/model-config').set('Cookie', cookie).expect(403);
    await app
      .put('/model-config')
      .set('Cookie', cookie)
      .send({
        endpoint_url: 'http://127.0.0.1/v1/chat/completions',
        model_name: 'blocked',
        credential: 'not-a-real-secret',
      })
      .expect(403);
    await app.post('/model-config/test').set('Cookie', cookie).expect(403);
  });

  it('lists members with a stable opaque composite cursor and bounded page size', async () => {
    const admin = await registerAndLogin(app, 'page-admin@example.com');
    for (let index = 0; index < 4; index += 1) {
      const member = await directCreateUser(pool, `page-member-${index}@example.com`);
      await directAddMember(pool, admin.orgId, member.id);
    }

    const first = await app
      .get('/members')
      .query({ limit: 2 })
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(first.body.members).toHaveLength(2);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    expect(first.body.next_cursor).not.toContain('{');
    expect(first.body.members[0]).toEqual(
      expect.objectContaining({
        user_id: expect.any(String),
        email: expect.stringContaining('@example.com'),
        role: expect.any(String),
        status: 'active',
      }),
    );

    const inserted = await directCreateUser(pool, 'inserted-between-pages@example.com');
    await directAddMember(pool, admin.orgId, inserted.id);

    const seenIds = new Set<string>(
      (first.body.members as { id: string }[]).map((member) => member.id),
    );
    let cursor: string | null = first.body.next_cursor as string;
    while (cursor) {
      const page = await app
        .get('/members')
        .query({ limit: 2, cursor })
        .set('Cookie', admin.cookie)
        .expect(200);
      for (const member of page.body.members as { id: string }[]) {
        expect(seenIds.has(member.id)).toBe(false);
        seenIds.add(member.id);
      }
      cursor = page.body.next_cursor as string | null;
    }
    expect(seenIds.size).toBe(6);

    await app
      .get('/members')
      .query({ cursor: 'not-a-valid-cursor' })
      .set('Cookie', admin.cookie)
      .expect(400);
    await app.get('/members').query({ limit: 101 }).set('Cookie', admin.cookie).expect(400);
  });

  it('creates and accepts a single-use invitation for the matching email', async () => {
    const admin = await registerAndLogin(app, 'invite-admin@example.com');
    await app
      .post('/members/invitations')
      .set('Cookie', admin.cookie)
      .send({ email: 'expired@example.com', role: 'member' })
      .expect(201);
    await withSystemTransaction(pool, async (ctx) => {
      await ctx.query(
        `UPDATE invitations
            SET expires_at = now() - interval '1 second'
          WHERE org_id = $1 AND email = 'expired@example.com'`,
        [admin.orgId],
      );
    });
    await app
      .post('/members/invitations')
      .set('Cookie', admin.cookie)
      .send({ email: 'expired@example.com', role: 'member' })
      .expect(201);

    const invitation = await app
      .post('/members/invitations')
      .set('Cookie', admin.cookie)
      .send({ email: 'invitee@example.com', role: 'member' })
      .expect(201);
    expect(Buffer.from(invitation.body.token as string, 'base64url')).toHaveLength(32);

    await app
      .post('/members/invitations')
      .set('Cookie', admin.cookie)
      .send({ email: 'INVITEE@example.com', role: 'member' })
      .expect(409);

    const wrongUser = await registerAndLogin(app, 'wrong-invitee@example.com');
    await app
      .post('/members/invitations/accept')
      .set('Cookie', wrongUser.cookie)
      .send({ token: invitation.body.token })
      .expect(404);

    const invitee = await registerAndLogin(app, 'invitee@example.com');
    const accepted = await app
      .post('/members/invitations/accept')
      .set('Cookie', invitee.cookie)
      .send({ token: invitation.body.token })
      .expect(201);
    expect(accepted.body).toMatchObject({ org_id: admin.orgId, role: 'member' });

    await app
      .post('/members/invitations/accept')
      .set('Cookie', invitee.cookie)
      .send({ token: invitation.body.token })
      .expect(404);

    const membership = await getMembershipId(pool, admin.orgId, invitee.userId);
    expect(membership).toBe(accepted.body.membership_id);
  });

  it('audit events are written in the same transaction as membership changes', async () => {
    const admin = await registerAndLogin(app, 'audit-admin@example.com');
    const member = await directCreateUser(pool, 'audit-member@example.com');
    const membership = await directAddMember(pool, admin.orgId, member.id, 'member');

    await app
      .patch(`/members/${membership.id}/role`)
      .set('Cookie', admin.cookie)
      .send({ role: 'administrator' })
      .expect(204);

    await withTransaction(pool, admin.orgId, async (ctx) => {
      const events = await ctx.query(
        'SELECT * FROM audit_events WHERE target_id = $1 ORDER BY created_at DESC',
        [membership.id],
      );
      expect(events.rows.length).toBeGreaterThanOrEqual(1);
      const event = events.rows[0];
      expect(event).toBeDefined();
      if (event) {
        expect(event.action).toBe('membership.role.update');
        expect(event.actor_user_id).toBe(admin.userId);
        expect(event.org_id).toBe(admin.orgId);
      }
    });

    const page = await app
      .get('/audit-events')
      .query({ limit: 1 })
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(page.body.events).toHaveLength(1);
    expect(page.body.events[0]).toMatchObject({
      action: 'membership.role.update',
      actor_user_id: admin.userId,
      target_id: membership.id,
    });
    expect(page.body.events[0]).not.toHaveProperty('org_id');
    await app
      .get('/audit-events')
      .query({ cursor: 'invalid' })
      .set('Cookie', admin.cookie)
      .expect(400);
  });

  it('rolls back a membership change when its audit insert cannot commit', async () => {
    const admin = await registerAndLogin(app, 'rollback-admin@example.com');
    const member = await directCreateUser(pool, 'rollback-member@example.com');
    const membership = await directAddMember(pool, admin.orgId, member.id);
    const adminClient = await adminPool.connect();
    try {
      await adminClient.query('REVOKE INSERT ON audit_events FROM craftifai_app');
      await app
        .patch(`/members/${membership.id}/role`)
        .set('Cookie', admin.cookie)
        .send({ role: 'administrator' })
        .expect(500);
    } finally {
      await adminClient.query('GRANT INSERT ON audit_events TO craftifai_app');
      adminClient.release();
    }

    await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      expect(await dal.memberships.findById(membership.id)).toMatchObject({ role: 'member' });
      const events = await ctx.query(
        `SELECT 1 FROM audit_events
          WHERE target_id = $1 AND action = 'membership.role.update'`,
        [membership.id],
      );
      expect(events.rowCount).toBe(0);
    });
  });
});

async function getMembershipId(
  pool: ReturnType<typeof createPool>,
  orgId: string,
  userId: string,
): Promise<string> {
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const m = await dal.memberships.findByOrgAndUser(orgId, userId);
    if (!m) throw new Error('Membership not found');
    return m.id;
  });
}
