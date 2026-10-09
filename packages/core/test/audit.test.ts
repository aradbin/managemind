import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { recordAudit, withTenant } from '../src';
import { connectApp, TENANT_B } from './setup';

let app: pg.Client;
beforeAll(async () => {
  app = await connectApp();
});
afterAll(() => app.end());

it('records an audit entry for the transaction tenant, with the request id', async () => {
  const entityId = crypto.randomUUID();
  await withTenant(
    app,
    TENANT_B,
    (tx) =>
      recordAudit(tx, {
        actorType: 'staff',
        action: 'settings.updated',
        entityType: 'tenant',
        entityId,
        before: { name: 'Old' },
        after: { name: 'New' },
        ip: '203.0.113.7',
      }),
    { requestId: 'req_audit' },
  );
  const { rows } = await withTenant(app, TENANT_B, () =>
    app.query(
      'select tenant_id, action, before, after, request_id, host(ip) as ip from store.audit_log where entity_id = $1',
      [entityId],
    ),
  );
  expect(rows).toEqual([
    {
      tenant_id: TENANT_B,
      action: 'settings.updated',
      before: { name: 'Old' },
      after: { name: 'New' },
      request_id: 'req_audit',
      ip: '203.0.113.7',
    },
  ]);
});
