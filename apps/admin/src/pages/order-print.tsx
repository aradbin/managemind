// Invoices and packing slips (phase-4-plan §3.17, Q13): printable pages the
// browser prints or saves as PDF, one order per page, so no server-side PDF
// and no Worker CPU. Invoices are A4 with the business details; packing
// slips are half an A4 with the address large, the amount to collect, the
// lines without prices and a QR code of the order number. Either prints in
// Bangla or English, whatever the admin's own language.
import type { Locale } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Notice } from '../components/notice';
import { QrCode } from '../components/qr-code';
import { Button } from '../components/ui/button';
import { type AdminKey, translate, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  dateOnly,
  lineLabel,
  type OrderDetail,
  type PrintData,
  pickText,
  placeLine,
} from '../lib/orders';

export interface PrintSearch {
  ids?: string;
  doc?: 'invoice' | 'slip';
}

interface Profile {
  businessName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: { line1: string; line2?: string; city?: string };
  tradeLicense?: string;
  dbid?: string;
  bin?: string;
}

export function OrderPrintPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as PrintSearch;
  const ids = (search.ids ?? '').split(',').filter(Boolean).slice(0, 100);
  const doc = search.doc === 'slip' ? 'slip' : 'invoice';
  const [lang, setLang] = useState<Locale>(locale);
  const data = useQuery({
    queryKey: ['order-print', ids] as const,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/orders/print', { params: { query: { ids: ids.join(',') } } }),
      ),
    enabled: ids.length > 0,
  });
  const title = translate(lang, doc === 'invoice' ? 'print.invoices' : 'print.slips');
  useEffect(() => {
    document.title = title;
  }, [title]);

  if (!ids.length) return <Notice tone="error">{t('print.none')}</Notice>;
  return (
    <div className="print-root bg-background">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          .print-page { break-after: page; box-shadow: none !important; margin: 0 !important; }
          .print-page:last-child { break-after: auto; }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background p-3">
        <span className="font-medium">
          {title} · {t('print.count', { count: ids.length })}
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          {t('print.language')}
          <select
            className="min-h-11 rounded-lg border border-input bg-background px-3"
            value={lang}
            onChange={(e) => setLang(e.target.value as Locale)}
          >
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </select>
        </label>
        <Button disabled={!data.data} onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t('print.print')}
        </Button>
      </div>
      {data.isPending && (
        <p role="status" className="p-4">
          {t('loading')}
        </p>
      )}
      {data.isError && (
        <div className="p-4">
          <Notice tone="error">{errorMessage(data.error, t)}</Notice>
        </div>
      )}
      {data.data && (
        <main
          lang={lang}
          className="flex flex-col items-center gap-6 bg-muted p-4 print:block print:bg-white print:p-0"
        >
          {data.data.orders.map((o) =>
            doc === 'invoice' ? (
              <Invoice key={o.id} order={o} store={data.data.store} lang={lang} />
            ) : (
              <Slip key={o.id} order={o} store={data.data.store} lang={lang} />
            ),
          )}
        </main>
      )}
    </div>
  );
}

const pageClass = 'print-page w-full bg-white text-black shadow-md';

function Invoice({
  order: o,
  store,
  lang,
}: {
  order: OrderDetail;
  store: PrintData['store'];
  lang: Locale;
}) {
  const tr = (key: AdminKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
  const money = (n: number) => formatPrice(n, lang);
  const p = store.profile as Profile;
  const vatOn = Boolean((store.tax as { vatEnabled?: boolean }).vatEnabled);
  const tt = o.totals;
  return (
    <article className={`${pageClass} max-w-[210mm] p-8 text-sm print:max-w-none print:p-0`}>
      <header className="mb-6 flex justify-between gap-6">
        <div>
          <h1 className="text-xl font-bold">{p.businessName ?? store.name}</h1>
          {p.address && (
            <p>{[p.address.line1, p.address.line2, p.address.city].filter(Boolean).join(', ')}</p>
          )}
          <p>{[p.contactPhone, p.contactEmail].filter(Boolean).join(' · ')}</p>
          {p.tradeLicense && <p>{tr('print.tradeLicense', { value: p.tradeLicense })}</p>}
          {p.dbid && <p>{tr('print.dbid', { value: p.dbid })}</p>}
          {vatOn && p.bin && <p>{tr('print.bin', { value: p.bin })}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{tr('print.invoice')}</p>
          <p>{tr('print.invoiceNo', { number: o.displayNumber })}</p>
          <p>{dateOnly(lang, o.placedAt)}</p>
          <p>{tr(`paymentStatus.${o.paymentStatus}` as AdminKey)}</p>
        </div>
      </header>
      <section className="mb-6">
        <h2 className="font-semibold">{tr('print.billTo')}</h2>
        <p>{o.contact.name}</p>
        <p>{o.contact.phone}</p>
        {o.address && (
          <p>
            {o.address.line}, {placeLine(o.address.names, lang)}
          </p>
        )}
      </section>
      <table className="mb-4 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1">{tr('print.item')}</th>
            <th className="py-1 text-right">{tr('print.qty')}</th>
            <th className="py-1 text-right">{tr('print.unit')}</th>
            {o.lines.some((l) => l.discount) ? (
              <th className="py-1 text-right">{tr('print.discount')}</th>
            ) : null}
            {vatOn && <th className="py-1 text-right">{tr('print.vat')}</th>}
            <th className="py-1 text-right">{tr('print.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-300 align-top">
              <td className="py-1">
                {lineLabel(l, lang)}
                {l.sku && <span className="block text-xs text-gray-600">{l.sku}</span>}
              </td>
              <td className="py-1 text-right">{formatCount(l.quantity, lang)}</td>
              <td className="py-1 text-right">{money(l.unitPrice)}</td>
              {o.lines.some((x) => x.discount) ? (
                <td className="py-1 text-right">{l.discount ? `−${money(l.discount)}` : ''}</td>
              ) : null}
              {vatOn && <td className="py-1 text-right">{money(l.vat)}</td>}
              <td className="py-1 text-right">{money(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto flex w-full max-w-xs flex-col gap-1">
        <Line label={tr('order.subtotal')} value={money(tt.subtotal)} />
        {o.adjustments
          .filter((a) => a.target !== 'delivery')
          .map((a) => (
            <Line
              key={a.id}
              label={[pickText(a.title, lang), a.code ? `(${a.code})` : '']
                .filter(Boolean)
                .join(' ')}
              value={`−${money(a.amount)}`}
            />
          ))}
        {o.address && (
          <Line label={tr('order.delivery')} value={money(tt.deliveryFee - tt.deliveryDiscount)} />
        )}
        {vatOn && tt.vatTotal > 0 && (
          <Line
            label={tr(tt.vatIncluded ? 'order.vatIncluded' : 'order.vat')}
            value={money(tt.vatTotal)}
          />
        )}
        {tt.rounding ? <Line label={tr('order.rounding')} value={money(tt.rounding)} /> : null}
        <div className="flex justify-between border-t-2 border-black pt-1 text-base font-bold">
          <dt>{tr('order.total')}</dt>
          <dd>{money(tt.total)}</dd>
        </div>
        {o.payments
          .filter((x) => x.status === 'paid')
          .map((x) => (
            <Line
              key={x.id}
              label={tr('print.paidBy', { method: tr(`method.${x.method}` as AdminKey) })}
              value={`−${money(x.amount)}`}
            />
          ))}
        {tt.codDue > 0 && <Line label={tr('order.codDue')} value={money(tt.codDue)} bold />}
      </dl>
      <footer className="mt-10 text-center text-xs text-gray-600">{tr('print.thanks')}</footer>
    </article>
  );
}

function Slip({
  order: o,
  store,
  lang,
}: {
  order: OrderDetail;
  store: PrintData['store'];
  lang: Locale;
}) {
  const tr = (key: AdminKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
  const p = store.profile as Profile;
  return (
    <article
      className={`${pageClass} flex h-[136mm] max-w-[210mm] flex-col gap-3 p-6 print:max-w-none print:p-0`}
    >
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <p className="font-bold">{store.name}</p>
          {p.contactPhone && <p className="text-sm">{p.contactPhone}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{o.displayNumber}</p>
          <p className="text-sm">{dateOnly(lang, o.placedAt)}</p>
        </div>
      </header>
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-sm text-gray-600">{tr('print.shipTo')}</p>
          <p className="text-2xl font-bold">{o.contact.name}</p>
          <p className="text-xl font-semibold">{o.contact.phone}</p>
          {o.address ? (
            <p className="text-xl">
              {o.address.line}
              <br />
              <strong>{placeLine(o.address.names, lang)}</strong>
            </p>
          ) : (
            <p className="text-lg">{tr('order.noDelivery')}</p>
          )}
          {o.zone.name && <p className="text-sm">{pickText(o.zone.name, lang)}</p>}
        </div>
        <QrCode
          value={o.displayNumber}
          label={tr('print.qr', { number: o.displayNumber })}
          className="size-28"
        />
      </div>
      <div className="rounded border-2 border-black p-2 text-center text-xl font-bold">
        {o.totals.codDue > 0
          ? tr('print.collect', { amount: formatPrice(o.totals.codDue, lang) })
          : tr('print.nothingToCollect')}
      </div>
      <ul className="flex-1 overflow-hidden text-sm">
        {o.lines.map((l) => (
          <li key={l.id} className="flex justify-between border-b border-gray-300 py-0.5">
            <span>{lineLabel(l, lang)}</span>
            <span className="font-semibold">× {formatCount(l.quantity, lang)}</span>
          </li>
        ))}
      </ul>
      {o.customerNote && (
        <p className="text-sm">
          {tr('order.customerNote')}: {o.customerNote}
        </p>
      )}
    </article>
  );
}

const formatCount = (n: number, lang: Locale) =>
  new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-BD').format(n);

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-bold' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
