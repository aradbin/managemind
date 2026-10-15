// Production's DNS and zone settings (phase-1-plan §10). Idempotent: the
// deploy runs it before the Workers, whose wrangler configs then attach
// admin.<platform> as a custom domain and the Workers routes.
//
//   tsx production/zones.ts        (PLATFORM_DOMAIN and STORE_DOMAIN set)
//
// - Proxied placeholder records for the Workers routes: api.<platform> and
//   the wildcard *.<store> (§3.5, §3.7).
// - Checks that the email provider's DKIM record and DMARC exist (Resend
//   adds them; we don't manage them).
// - "Block AI bots" and the WAF rule for cross-site writes to the admin's
//   API (§3.6). These need Bot Management and Zone WAF edit rights, which
//   the deploy token may not have: then this warns and carries on.
import { notice, requireEnv, warning } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { HttpError } from '../lib/http';

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const platform = requireEnv('PLATFORM_DOMAIN');
const store = requireEnv('STORE_DOMAIN');
const [platformZone, storeZone] = await Promise.all([cf.zoneId(platform), cf.zoneId(store)]);

for (const [zone, name] of [
  [platformZone, `api.${platform}`],
  [storeZone, `*.${store}`],
] as const) {
  notice(`DNS ${name}: ${await cf.ensureRoutePlaceholder(zone, name)}`);
}

const [dkim, dmarc] = await Promise.all([
  cf.dnsRecords(platformZone, `resend._domainkey.${platform}`, 'TXT'),
  cf.dnsRecords(platformZone, `_dmarc.${platform}`, 'TXT'),
]);
if (!dkim.length) warning(`No DKIM record for ${platform}: production email will be refused`);
if (!dmarc.length) warning(`No DMARC record for ${platform}`);

/** Runs a setting the token may lack rights for; says how to do it by hand instead. */
async function optional(what: string, byHand: string, fn: () => Promise<void>) {
  try {
    await fn();
    notice(`${what}: done`);
  } catch (e) {
    if (!(e instanceof HttpError && (e.status === 401 || e.status === 403))) throw e;
    warning(`${what}: the API token can't change this. ${byHand}`);
  }
}

await optional(
  `Block AI bots on ${platform}`,
  `Cloudflare dashboard > ${platform} > Security > Bots > Block AI bots: on.`,
  () => cf.blockAiBots(platformZone),
);
const admin = `admin.${platform}`;
await optional(
  `WAF rule for cross-site writes to ${admin}/api`,
  'Or give the token Zone WAF: Edit and redeploy.',
  () =>
    cf.ensureWafRule(platformZone, {
      ref: 'mm_admin_api_cross_site_writes',
      description: 'managemind: block writes to the admin API from other sites (phase-1-plan 3.6)',
      expression: `(http.host eq "${admin}" and starts_with(http.request.uri.path, "/api/") and http.request.method in {"POST" "PUT" "PATCH" "DELETE"} and not any(http.request.headers["origin"][*] eq "https://${admin}"))`,
      action: 'block',
    }),
);
