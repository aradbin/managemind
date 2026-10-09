// One valid row per store table, used by the isolation suite. `tenant` is
// either 'default' (taken from the transaction's tenant) or a quoted UUID.
// The catalog test fails if a store table has no fixture, so every new table
// joins the isolation suite.
export const FIXTURES: Record<string, (tenant: string) => string> = {
  outbox: (tenant) =>
    `insert into store.outbox (tenant_id, event_type, aggregate_type, payload)
     values (${tenant}, 'test.fixture', 'test', '{}')`,
  audit_log: (tenant) =>
    `insert into store.audit_log (tenant_id, actor_type, action)
     values (${tenant}, 'system', 'test.fixture')`,
  idempotency_keys: (tenant) =>
    `insert into store.idempotency_keys (tenant_id, scope, key, request_hash, locked_until)
     values (${tenant}, 'test.fixture', 'fixture-' || gen_random_uuid(), 'hash', now())`,
};
