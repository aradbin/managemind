// What a store's legal templates are filled from (phase-5b-plan §3.15): its
// profile, return policy, delivery zones and payment methods, and the
// platform's abuse address. Read each time a page that follows its template
// is shown, so a settings change shows at once (the `legal` cache tag).
import { schema } from '@managemind/db';
import type { Locale } from '@managemind/shared/money';
import { formatPhone } from '@managemind/shared/phone';
import { tenantSettings } from '@managemind/shared/settings';
import { type LegalContext, type LegalKind, legalPageBody } from '@managemind/shared/storefront';
import { and, asc, eq } from 'drizzle-orm';
import type { TenantTx } from '../tenant';
import { getSupport } from '../terms/support';

export async function legalContext(tx: TenantTx, platformName: string): Promise<LegalContext> {
  const [store] = await tx.db
    .select({ name: schema.tenants.name, settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  const settings = tenantSettings.parse(store?.settings ?? {});
  const p = settings.profile;
  const z = schema.deliveryZones;
  const zones = await tx.db
    .select({ name: z.name, fee: z.fee, estimate: z.estimate })
    .from(z)
    .where(and(eq(z.tenantId, tx.tenantId), eq(z.active, true)))
    .orderBy(asc(z.position));
  const [gateway] = await tx.db
    .select({ kind: schema.providerCredentials.kind })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.tenantId, tx.tenantId),
        eq(schema.providerCredentials.kind, 'sslcommerz'),
      ),
    )
    .limit(1);
  const support = await getSupport(tx);
  const estimate = (e: unknown) => {
    const v = e as Partial<Record<Locale, string>> | null;
    return v?.bn || v?.en ? { bn: v.bn ?? v.en ?? '', en: v.en ?? v.bn ?? '' } : null;
  };
  return {
    storeName: store?.name ?? '',
    businessName: p.businessName,
    address: p.address
      ? [p.address.line1, p.address.line2, p.address.city].filter(Boolean).join(', ')
      : undefined,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone ? formatPhone(p.contactPhone) : undefined,
    tradeLicense: p.tradeLicense,
    dbid: p.dbid,
    returns: {
      shopperRequests: settings.returns.shopperRequests,
      windowDays: settings.returns.windowDays,
      refundMethods: settings.returns.refundMethods,
      refundDeliveryFee: settings.returns.refundDeliveryFee,
    },
    zones: zones.map((row) => {
      const name = row.name as Partial<Record<Locale, string>>;
      return {
        name: { bn: name.bn ?? name.en ?? '', en: name.en ?? name.bn ?? '' },
        fee: row.fee,
        estimate: estimate(row.estimate),
      };
    }),
    cod: settings.cod.enabled,
    online: Boolean(gateway),
    abuseEmail: support.abuseEmail,
    platformName,
  };
}

/** A legal page's body as its template fills it now. */
export async function legalBody(
  tx: TenantTx,
  kind: LegalKind,
  locale: Locale,
  platformName: string,
) {
  return legalPageBody(kind, locale, await legalContext(tx, platformName));
}
