// Releasing a closed store's domains (apps/api/src/domains.ts) twice at once:
// the close's queue message and the purge request both do it, and the
// second must skip what the first removed rather than fail.
import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { releaseDomains } from '../src/domains';
import { makeCtx, makeEnv, ownerUrl } from './support';

let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => owner.end());

describe('releasing a closed store’s domains', () => {
  it('skips a domain another release removed while it waited', async () => {
    const slug = `rd${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const { id } = await createTenant(owner, systemActor, {
      slug,
      name: 'Closing Shop',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    });
    await owner.query(
      `update platform.tenants set status = 'closed', closed_at = now(), purge_after = now() where id = $1`,
      [id],
    );
    const {
      rows: [domain],
    } = await owner.query<{ id: string }>(
      `insert into platform.tenant_domains (tenant_id, hostname, status)
       values ($1, $2, 'active') returning id`,
      [id, `${slug}.example.test`],
    );

    // The other release holds the row and removes it.
    const other = await connect(ownerUrl);
    await other.query('begin');
    await other.query(`update platform.tenant_domains set status = 'removed' where id = $1`, [
      domain?.id,
    ]);
    const released = releaseDomains(makeEnv(), makeCtx(), id);
    await new Promise((r) => setTimeout(r, 300));
    await other.query('commit');
    await other.end();

    await expect(released).resolves.toBe(0);
  });
});
