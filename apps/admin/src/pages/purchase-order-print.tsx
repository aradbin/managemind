// A purchase order to send the supplier (phase-8-plan §3.2, §3.12): an A4
// page the browser prints or saves as PDF, or a WhatsApp message with the
// lines. Opened in its own tab, outside the shell, like the invoices.
import { formatPhone } from '@managemind/shared/phone';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { MessageCircle, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Notice } from '../components/notice';
import { deskClass, PrintBar, paperClass } from '../components/print-bar';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateOnly, lineLabel } from '../lib/orders';
import { priceOrDash, purchaseOrderQuery, supplierQuery } from '../lib/purchasing';
import { cn } from '../lib/utils';

export function PurchaseOrderPrintPage() {
  const { t, locale } = useLocale();
  const { id } = useSearch({ strict: false }) as { id?: string };
  const order = useQuery({ ...purchaseOrderQuery(id ?? ''), enabled: Boolean(id) });
  const supplier = useQuery({
    ...supplierQuery(order.data?.supplier.id ?? ''),
    enabled: Boolean(order.data),
  });
  const store = useQuery(storeSettingsQuery);
  const title = order.data ? t('printPo.title', { reference: order.data.reference }) : '';
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
  if (!id) return <Notice tone="error">{t('print.none')}</Notice>;
  if (order.isPending) return <p role="status">{t('loading')}</p>;
  if (order.isError) return <Notice tone="error">{errorMessage(order.error, t)}</Notice>;
  const o = order.data;
  // The store's profile, as the invoices print it.
  const profile = store.data?.profile as
    | {
        businessName?: string;
        contactPhone?: string;
        address?: { line1: string; city?: string };
      }
    | undefined;
  const costs = o.total !== undefined;
  const phone = supplier.data?.phones[0]?.replace(/^\+/, '');
  const message = [
    `${store.data?.name ?? ''} — ${title}`,
    ...o.lines.map((l) => `• ${lineLabel(l, locale)}${l.sku ? ` (${l.sku})` : ''} × ${l.quantity}`),
    ...(o.expectedOn ? [`${t('po.expectedOn')}: ${dateOnly(locale, o.expectedOn)}`] : []),
    ...(o.note ? [o.note] : []),
  ].join('\n');
  const whatsapp = `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(message)}`;
  return (
    <div className="print-root min-h-dvh bg-muted print:bg-white">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
      <PrintBar
        back={{
          to: '/inventory/purchase-orders/$id',
          params: { id: o.id },
          label: t('nav.purchaseOrders'),
        }}
        title={title}
        actions={
          <>
            <Button variant="secondary" asChild>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                {t('printPo.share')}
              </a>
            </Button>
            <Button onClick={() => window.print()}>
              <Printer aria-hidden />
              {t('printPo.print')}
            </Button>
          </>
        }
      />
      <main className={deskClass}>
        <article className={cn(paperClass, 'flex flex-col gap-6')}>
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[22px] leading-7 font-bold">{title}</h1>
            <p>
              {t('printPo.date')}: {dateOnly(locale, o.placedAt ?? o.createdAt)}
              {o.expectedOn && ` · ${t('po.expectedOn')}: ${dateOnly(locale, o.expectedOn)}`}
            </p>
            {o.supplierRef && (
              <p className="text-[#555]">
                {t('po.supplierRef')}: {o.supplierRef}
              </p>
            )}
          </header>
          <div className="grid grid-cols-2 gap-6">
            <section>
              <p className="mb-1 font-semibold">{t('printPo.from')}</p>
              <p>{profile?.businessName ?? store.data?.name}</p>
              {(profile?.address || profile?.contactPhone) && (
                <p>
                  {[
                    profile.address?.line1,
                    profile.address?.city,
                    profile.contactPhone && formatPhone(profile.contactPhone),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </section>
            <section>
              <p className="mb-1 font-semibold">{t('printPo.to')}</p>
              <p>{o.supplier.name}</p>
              {supplier.data && (
                <>
                  <p>
                    {[supplier.data.contactName, ...supplier.data.phones]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {supplier.data.address?.line1 && <p>{supplier.data.address.line1}</p>}
                </>
              )}
            </section>
          </div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#111] text-xs">
                <th scope="col" className="py-1.5 font-semibold">
                  {t('po.lines')}
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  {t('po.ordered')}
                </th>
                {costs && (
                  <>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      {t('po.unitCost')}
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      {t('po.lineTotal')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.id} className="border-b border-[#ddd] align-top">
                  <td className="py-[7px]">
                    {lineLabel(l, locale)}
                    {l.sku && (
                      <span lang="en" className="block text-[11px] text-[#666]">
                        {l.sku}
                      </span>
                    )}
                  </td>
                  <td className="py-[7px] text-right tabular-nums">{l.quantity}</td>
                  {costs && (
                    <>
                      <td className="py-[7px] text-right tabular-nums">
                        {priceOrDash(l.unitCost, locale)}
                      </td>
                      <td className="py-[7px] text-right tabular-nums">
                        {priceOrDash((l.unitCost ?? 0) * l.quantity, locale)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {costs && (
            <dl className="ml-auto flex w-[300px] max-w-full flex-col gap-1">
              <div className="flex justify-between">
                <dt>{t('po.subtotal')}</dt>
                <dd className="tabular-nums">{priceOrDash(o.subtotal, locale)}</dd>
              </div>
              {o.otherCosts?.map((c) => (
                <div key={c.label} className="flex justify-between">
                  <dt>{c.label}</dt>
                  <dd className="tabular-nums">{priceOrDash(c.amount, locale)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-[#111] pt-1.5 font-bold">
                <dt>{t('po.total')}</dt>
                <dd className="tabular-nums">{priceOrDash(o.total, locale)}</dd>
              </div>
            </dl>
          )}
          {o.note && <p className="whitespace-pre-line">{o.note}</p>}
        </article>
      </main>
    </div>
  );
}
