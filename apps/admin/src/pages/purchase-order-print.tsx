// A purchase order to send the supplier (phase-8-plan §3.2, §3.12): an A4
// page the browser prints or saves as PDF, or a WhatsApp message with the
// lines. Opened in its own tab, outside the shell, like the invoices.
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Printer, Share2 } from 'lucide-react';
import { useEffect } from 'react';
import { Notice } from '../components/notice';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateOnly, lineLabel } from '../lib/orders';
import { priceOrDash, purchaseOrderQuery, supplierQuery } from '../lib/purchasing';

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
    <div className="print-root bg-background">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background p-3">
        <span className="font-medium">{title}</span>
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" asChild>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <Share2 aria-hidden className="size-4" />
              {t('printPo.share')}
            </a>
          </Button>
          <Button onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('printPo.print')}
          </Button>
        </span>
      </div>
      <main className="mx-auto flex max-w-[210mm] flex-col gap-6 p-6 text-sm">
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p>
              {t('printPo.date')}: {dateOnly(locale, o.placedAt ?? o.createdAt)}
            </p>
            {o.expectedOn && (
              <p>
                {t('po.expectedOn')}: {dateOnly(locale, o.expectedOn)}
              </p>
            )}
            {o.supplierRef && (
              <p>
                {t('po.supplierRef')}: {o.supplierRef}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">{t('printPo.from')}</p>
            <p className="font-semibold">{store.data?.name}</p>
          </div>
        </header>
        <section>
          <p className="text-muted-foreground">{t('printPo.to')}</p>
          <p className="font-semibold">{o.supplier.name}</p>
          {supplier.data && (
            <p>
              {[supplier.data.contactName, ...supplier.data.phones, supplier.data.address?.line1]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </section>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-foreground">
              <th scope="col" className="py-2">
                {t('po.lines')}
              </th>
              <th scope="col" className="py-2">
                SKU
              </th>
              <th scope="col" className="py-2 text-right">
                {t('po.ordered')}
              </th>
              {costs && (
                <>
                  <th scope="col" className="py-2 text-right">
                    {t('po.unitCost')}
                  </th>
                  <th scope="col" className="py-2 text-right">
                    {t('po.lineTotal')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="py-2">{lineLabel(l, locale)}</td>
                <td className="py-2">{l.sku ?? ''}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                {costs && (
                  <>
                    <td className="py-2 text-right tabular-nums">
                      {priceOrDash(l.unitCost, locale)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {priceOrDash((l.unitCost ?? 0) * l.quantity, locale)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {costs && (
          <dl className="ml-auto grid w-64 grid-cols-2 gap-1">
            <dt>{t('po.subtotal')}</dt>
            <dd className="text-right tabular-nums">{priceOrDash(o.subtotal, locale)}</dd>
            {o.otherCosts?.map((c) => (
              <div key={c.label} className="contents">
                <dt>{c.label}</dt>
                <dd className="text-right tabular-nums">{priceOrDash(c.amount, locale)}</dd>
              </div>
            ))}
            <dt className="font-semibold">{t('po.total')}</dt>
            <dd className="text-right font-semibold tabular-nums">
              {priceOrDash(o.total, locale)}
            </dd>
          </dl>
        )}
        {o.note && <p className="whitespace-pre-line">{o.note}</p>}
      </main>
    </div>
  );
}
