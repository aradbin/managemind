import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { fakeTurnstileWidget } from '@managemind/providers/turnstile';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syncTurnstileHosts, turnstileKeyFor } from '../src/turnstile-hosts';
import { appUrl, makeEnv } from './support';

let app: pg.Client;
beforeAll(async () => {
  app = await connect(appUrl);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => app.end());

async function store() {
  const slug = `ts${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'Turnstile Store',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  return { id, slug };
}

async function addDomain(tenantId: string, hostname: string, status: string) {
  await app.query(
    'insert into platform.tenant_domains (tenant_id, hostname, status) values ($1, $2, $3)',
    [tenantId, hostname, status],
  );
}

const onWidget = async (tenantId: string) => {
  const { rows } = await app.query<{ hostname: string; turnstile: boolean }>(
    'select hostname, turnstile from platform.tenant_domains where tenant_id = $1 order by hostname',
    [tenantId],
  );
  return Object.fromEntries(rows.map((r) => [r.hostname, r.turnstile]));
};

describe('Turnstile widget hostnames', () => {
  it('adds active domains, leaves pending ones off, and changes nothing on a redelivery', async () => {
    const { id, slug } = await store();
    await addDomain(id, `shop.${slug}.example.test`, 'active');
    await addDomain(id, `new.${slug}.example.test`, 'pending');
    const widget = fakeTurnstileWidget(['stores.example.test', 'admin.platform.example.test']);
    const first = await syncTurnstileHosts(app, widget, id);
    expect(first).toEqual({ added: [`shop.${slug}.example.test`], removed: [], refused: [] });
    expect(widget.list).toContain(`shop.${slug}.example.test`);
    expect(await onWidget(id)).toEqual({
      [`new.${slug}.example.test`]: false,
      [`shop.${slug}.example.test`]: true,
    });
    const again = await syncTurnstileHosts(app, widget, id);
    expect(again).toEqual({ added: [], removed: [], refused: [] });
  });

  it('takes a removed domain off and keeps the platform hosts', async () => {
    const { id, slug } = await store();
    const host = `gone.${slug}.example.test`;
    await addDomain(id, host, 'removed');
    const widget = fakeTurnstileWidget(['stores.example.test', host]);
    const result = await syncTurnstileHosts(app, widget, id);
    expect(result.removed).toEqual([host]);
    expect(widget.list).toEqual(['stores.example.test']);
    expect(await onWidget(id)).toEqual({ [host]: false });
  });

  it('records a domain that does not fit as off the widget', async () => {
    const { id, slug } = await store();
    const host = `full.${slug}.example.test`;
    await addDomain(id, host, 'active');
    const widget = fakeTurnstileWidget(['a.example.test', 'b.example.test'], 2);
    const result = await syncTurnstileHosts(app, widget, id);
    expect(result).toEqual({ added: [], removed: [], refused: [host] });
    expect(widget.list).toEqual(['a.example.test', 'b.example.test']);
    expect(await onWidget(id)).toEqual({ [host]: false });
  });
});

describe('the site key for a host', () => {
  const keys = makeEnv({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
  const never = async () => {
    throw new Error('not asked');
  };

  it('is off without keys', async () => {
    expect(
      await turnstileKeyFor(makeEnv(), 'a.stores.example.test', 'stores.example.test', never),
    ).toBeNull();
  });

  it('is on for store subdomains without asking, and follows the widget for custom domains', async () => {
    expect(await turnstileKeyFor(keys, 'A.Stores.Example.Test', 'stores.example.test', never)).toBe(
      'site',
    );
    const listed = (value: boolean | null) => async () => value;
    expect(await turnstileKeyFor(keys, 'shop.test', 'stores.example.test', listed(true))).toBe(
      'site',
    );
    expect(
      await turnstileKeyFor(keys, 'shop.test', 'stores.example.test', listed(false)),
    ).toBeNull();
    // Not a custom domain (a preview's workers.dev host): the key applies.
    expect(await turnstileKeyFor(keys, 'x.workers.dev', 'stores.example.test', listed(null))).toBe(
      'site',
    );
  });
});
