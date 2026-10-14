// The platform CLI (phase-1-plan §8):
//
//   pnpm platform tenant:create --slug acme --name "Acme" --owner-email a@b.c [--owner-name] [--locale bn|en]
//   pnpm platform platform:grant-role --email a@b.c --role super_admin|support|none
//   pnpm platform kv:sync [--tenant <id>]
//
// Locally it uses DATABASE_URL. In production, platform.yml runs it with
// DATABASE_URL_MIGRATIONS, so production credentials never enter a session.
// With Cloudflare credentials it relays events through Queues and writes KV;
// without them (locally) it skips both.
import pg from 'pg';
import { mask, parseArgs } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { grantRole, kvSync, type PlatformTargets, tenantCreate } from './commands';

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const need = (name: string) => {
  const value = args.get(name);
  if (!value || value === 'true') throw new Error(`--${name} is required`);
  return value;
};

function parseLocale(value: string | undefined): 'bn' | 'en' | undefined {
  if (value === undefined || value === 'bn' || value === 'en') return value;
  throw new Error('--locale must be bn or en');
}

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) throw new Error('set DATABASE_URL (or DATABASE_URL_MIGRATIONS)');

async function cloudflare(): Promise<{ targets: PlatformTargets; workersDev: string } | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return null;
  const cf = new Cloudflare(token, account);
  const [queue, kv, subdomain] = await Promise.all([
    cf.queueId('managemind-outbox'),
    cf.ensureKvNamespace('managemind-edge'),
    cf.workersSubdomain(),
  ]);
  return {
    workersDev: `${subdomain}.workers.dev`,
    targets: {
      sendEvents: (events) => cf.sendToQueue(queue, events),
      kvPut: (entries) => cf.kvPutMany(kv, entries),
      kvDelete: (keys) => cf.kvDeleteMany(kv, keys),
    },
  };
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const cf = await cloudflare();
  // The same defaults as the deploy (scripts/production/workers.ts) until the domains are connected.
  const storeDomain = process.env.STORE_DOMAIN || cf?.workersDev || 'localhost';
  const adminHost =
    process.env.ADMIN_HOST || (cf ? `managemind-api.${cf.workersDev}` : 'localhost:8787');

  switch (command) {
    case 'tenant:create': {
      const ownerEmail = need('owner-email');
      mask(ownerEmail);
      const locale = parseLocale(args.get('locale'));
      const ownerName = args.get('owner-name');
      const result = await tenantCreate(
        client,
        cf?.targets ?? null,
        { storeDomain, adminHost },
        {
          slug: need('slug'),
          name: need('name'),
          ownerEmail,
          ...(ownerName ? { ownerName } : {}),
          ...(locale ? { locale } : {}),
        },
      );
      console.log(`Created store ${result.slug} (${result.id})`);
      console.log(`Admin: ${result.adminUrl}`);
      console.log(`Store: ${result.storeUrl}`);
      console.log(
        cf
          ? `Relayed ${result.relayed} event(s); KV fills in seconds`
          : 'No Cloudflare credentials: events left for the daily sweep',
      );
      break;
    }
    case 'platform:grant-role': {
      const email = need('email');
      mask(email);
      const result = await grantRole(client, { email, role: need('role') });
      console.log(
        `${result.created ? 'Created user' : 'User'} ${result.userId}: platform role ${result.role ?? 'none'}`,
      );
      break;
    }
    case 'kv:sync': {
      if (!cf) throw new Error('kv:sync needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
      const result = await kvSync(client, cf.targets, storeDomain, args.get('tenant'));
      console.log(
        `Synced ${result.stores} store(s): ${result.put} key(s) written, ${result.deleted} deleted`,
      );
      break;
    }
    default:
      throw new Error('usage: pnpm platform tenant:create | platform:grant-role | kv:sync');
  }
} finally {
  await client.end();
}
