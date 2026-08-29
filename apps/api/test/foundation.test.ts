import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { withTransaction, withSystemTransaction, createDal, createPool } from '@craftifai/db';
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
import type supertest from 'supertest';

const enabled = hasTestDatabase() && hasTestRedis();
const describeIf = enabled ? describe : describe.skip;

describeIf('Phase 1 foundation', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let pool: ReturnType<typeof createTestApp>['pool'];
  let redis: ReturnType<typeof createTestApp>['redis'];

  beforeAll(() => {
    const testApp = createTestApp();
    app = testApp.app;
    pool = testApp.pool;
    redis = testApp.redis;
    runMigrations();
  });

  beforeEach(async () => {
    await truncateTables(pool);
  });

  afterAll(async () => {
    await redis.quit();
    await pool.end();
  });

  it('tenant isolation: org A context cannot see org B resources by direct id', async () => {
    const orgA = await withSystemTransaction(pool, async (ctx) => {
      const dal = createDal(ctx);
      return dal.organizations.create('Org A');
    });
    const orgB = await withSystemTransaction(pool, async (ctx) => {
      const dal = createDal(ctx);
      return dal.organizations.create('Org B');
    });
    const userA = await directCreateUser(pool, 'a@example.com');
    const userB = await directCreateUser(pool, 'b@example.com');
    await directAddMember(pool, orgA.id, userA.id, 'administrator');
    await directAddMember(pool, orgB.id, userB.id, 'administrator');
    await withSystemTransaction(pool, async (ctx) => {
      await ctx.query(
        'INSERT INTO org_credit_accounts (org_id, available, reserved) VALUES ($1, 0, 0)',
        [orgB.id],
      );
    });

    await withTransaction(pool, orgA.id, async (ctx) => {
      const dal = createDal(ctx);
      expect(await dal.organizations.findById(orgB.id)).toBeUndefined();
      expect(await dal.memberships.findByOrgAndUser(orgB.id, userB.id)).toBeUndefined();
    });

    // API layer: using user A's session with an org B header should not authenticate into org B.
    const { cookie } = await registerAndLogin(app, 'api-a@example.com');
    await app.get('/orgs').set('Cookie', cookie).set('X-Org-Id', orgB.id).expect(404);
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
      .then((res: supertest.Response) => expect(res.body.user_id).toBe(member.id));

    const memberMembershipId = await getMembershipId(pool, admin.orgId, member.id);
    await app
      .patch(`/members/${memberMembershipId}`)
      .set('Cookie', admin.cookie)
      .send({ status: 'suspended' })
      .expect(204);

    await app.get('/auth/me').set('Cookie', cookie).expect(404);
  });

  it('last-admin rule: only one of two concurrent demotions succeeds', async () => {
    const org = await withSystemTransaction(pool, async (ctx) => {
      const dal = createDal(ctx);
      return dal.organizations.create('Concurrent org');
    });
    const admin1 = await directCreateUser(pool, 'admin1@example.com');
    const admin2 = await directCreateUser(pool, 'admin2@example.com');
    await directAddMember(pool, org.id, admin1.id, 'administrator');
    await directAddMember(pool, org.id, admin2.id, 'administrator');
    await withSystemTransaction(pool, async (ctx) => {
      await ctx.query(
        'INSERT INTO org_credit_accounts (org_id, available, reserved) VALUES ($1, 0, 0)',
        [org.id],
      );
    });

    const session1 = await app
      .post('/auth/login')
      .send({ email: 'admin1@example.com', password: 'password123' });
    const session2 = await app
      .post('/auth/login')
      .send({ email: 'admin2@example.com', password: 'password123' });
    const cookie1 = getCookies(session1);
    const cookie2 = getCookies(session2);

    const m1 = await getMembershipId(pool, org.id, admin1.id);
    const m2 = await getMembershipId(pool, org.id, admin2.id);

    const [r1, r2] = await Promise.all([
      app.patch(`/members/${m1}`).set('Cookie', cookie1).send({ role: 'member' }),
      app.patch(`/members/${m2}`).set('Cookie', cookie2).send({ role: 'member' }),
    ]);

    const successes = [r1.status === 204, r2.status === 204].filter(Boolean).length;
    expect(successes).toBe(1);

    const admins = await withSystemTransaction(pool, async (ctx) => {
      const dal = createDal(ctx);
      return dal.memberships.countActiveAdmins(org.id);
    });
    expect(admins).toBe(1);
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
  });

  it('audit events are written in the same transaction as membership changes', async () => {
    const admin = await registerAndLogin(app, 'audit-admin@example.com');
    const member = await directCreateUser(pool, 'audit-member@example.com');
    const membership = await directAddMember(pool, admin.orgId, member.id, 'member');

    await app
      .patch(`/members/${membership.id}`)
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
  });
});

async function getMembershipId(
  pool: ReturnType<typeof createPool>,
  orgId: string,
  userId: string,
): Promise<string> {
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    const m = await dal.memberships.findByOrgAndUser(orgId, userId);
    if (!m) throw new Error('Membership not found');
    return m.id;
  });
}
