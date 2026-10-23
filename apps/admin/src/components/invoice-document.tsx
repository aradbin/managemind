// One of our invoices to a store, as it prints (phase-5b-plan §3.7): our
// details and the store's as they were when it was issued, the lines, the
// totals and what was paid. Used by the store's billing page, its print
// page and Platform → Billing; the language is the reader's choice.
import type { Locale } from '@managemind/shared/i18n';
import { type AdminKey, translate } from '../i18n';
import '../i18n/billing';
import { formatDay } from '../lib/billing';
import { formatPrice } from '../lib/catalog';

type Status = 'draft' | 'issued' | 'paid' | 'void';
type Method = 'bank' | 'bkash' | 'nagad' | 'cash' | 'sslcommerz';

export interface InvoiceDoc {
  number: string | null;
  status: Status;
  overdue: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  subtotal: number;
  vat: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  voidReason: string | null;
  issuer: Record<string, unknown> | null;
  billedTo: Record<string, unknown> | null;
  lines: {
    kind: string;
    description: { bn: string; en: string };
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  payments: { amount: number; method: Method; reference: string | null; paidOn: string }[];
}

const text = (o: Record<string, unknown> | null, key: string) =>
  typeof o?.[key] === 'string' && o[key] ? (o[key] as string) : null;

export function statusLabel(lang: Locale, i: { status: Status; overdue: boolean }) {
  return translate(
    lang,
    i.overdue ? 'invoice.overdue' : (`invoice.status.${i.status}` as AdminKey),
  );
}

export function InvoiceDocument({ invoice: inv, lang }: { invoice: InvoiceDoc; lang: Locale }) {
  const t = (key: AdminKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
  const price = (n: number) => formatPrice(n, lang);
  const issuer = inv.issuer;
  const to = inv.billedTo;
  const emails = Array.isArray(to?.emails) ? (to.emails as string[]) : [];
  return (
    <article lang={lang} className="flex flex-col gap-6 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {inv.number ? t('invoice.title', { number: inv.number }) : t('invoice.draftTitle')}
          </h2>
          <p className="font-medium">{statusLabel(lang, inv)}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {inv.issuedOn && (
            <>
              <dt className="text-muted-foreground">{t('invoice.issuedOn')}</dt>
              <dd>{formatDay(lang, inv.issuedOn)}</dd>
            </>
          )}
          {inv.dueOn && (
            <>
              <dt className="text-muted-foreground">{t('invoice.dueOn')}</dt>
              <dd>{formatDay(lang, inv.dueOn)}</dd>
            </>
          )}
          {inv.periodStart && inv.periodEnd && (
            <>
              <dt className="text-muted-foreground">{t('invoice.period')}</dt>
              <dd>
                {t('invoice.periodRange', {
                  start: formatDay(lang, inv.periodStart),
                  end: formatDay(lang, inv.periodEnd),
                })}
              </dd>
            </>
          )}
        </dl>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="text-muted-foreground">{t('invoice.from')}</h3>
          {issuer ? (
            <address className="not-italic">
              <span className="block font-medium">{text(issuer, 'legalName')}</span>
              <span className="block whitespace-pre-line">{text(issuer, 'address')}</span>
              {text(issuer, 'bin') && (
                <span className="block">
                  {t('invoice.bin', { bin: text(issuer, 'bin') ?? '' })}
                </span>
              )}
              {text(issuer, 'tradeLicense') && (
                <span className="block">
                  {t('invoice.tradeLicense', { number: text(issuer, 'tradeLicense') ?? '' })}
                </span>
              )}
              {text(issuer, 'email') && <span className="block">{text(issuer, 'email')}</span>}
              {text(issuer, 'phone') && <span className="block">{text(issuer, 'phone')}</span>}
            </address>
          ) : (
            <p>—</p>
          )}
        </section>
        <section>
          <h3 className="text-muted-foreground">{t('invoice.to')}</h3>
          {to ? (
            <address className="not-italic">
              <span className="block font-medium">
                {text(to, 'businessName') ?? text(to, 'storeName')}
              </span>
              {text(to, 'businessName') && <span className="block">{text(to, 'storeName')}</span>}
              {text(to, 'address') && <span className="block">{text(to, 'address')}</span>}
              {text(to, 'bin') && (
                <span className="block">{t('invoice.bin', { bin: text(to, 'bin') ?? '' })}</span>
              )}
              {emails.map((e) => (
                <span key={e} className="block">
                  {e}
                </span>
              ))}
            </address>
          ) : (
            <p>—</p>
          )}
        </section>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 text-start font-normal">{t('invoice.item')}</th>
            <th className="text-end font-normal">{t('invoice.qty')}</th>
            <th className="text-end font-normal">{t('invoice.unitPrice')}</th>
            <th className="text-end font-normal">{t('invoice.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines
            .filter((l) => l.kind !== 'vat')
            .map((l, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-2">{l.description[lang] || l.description.en}</td>
                <td className="text-end">{l.quantity}</td>
                <td className="text-end">{price(l.unitPrice)}</td>
                <td className="text-end">{price(l.amount)}</td>
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3} className="pt-2 text-end font-normal">
              {t('invoice.subtotal')}
            </th>
            <td className="pt-2 text-end">{price(inv.subtotal)}</td>
          </tr>
          {inv.vat > 0 && (
            <tr>
              <th scope="row" colSpan={3} className="text-end font-normal">
                {t('invoice.vat')}
              </th>
              <td className="text-end">{price(inv.vat)}</td>
            </tr>
          )}
          <tr className="font-semibold">
            <th scope="row" colSpan={3} className="text-end">
              {t('invoice.total')}
            </th>
            <td className="text-end">{price(inv.total)}</td>
          </tr>
          {inv.amountPaid > 0 && (
            <tr>
              <th scope="row" colSpan={3} className="text-end font-normal">
                {t('invoice.paid')}
              </th>
              <td className="text-end">{price(inv.amountPaid)}</td>
            </tr>
          )}
          {inv.status === 'issued' && (
            <tr className="font-semibold">
              <th scope="row" colSpan={3} className="text-end">
                {t('invoice.amountDue')}
              </th>
              <td className="text-end">{price(inv.amountDue)}</td>
            </tr>
          )}
        </tfoot>
      </table>
      {inv.payments.length > 0 && (
        <section>
          <h3 className="text-muted-foreground">{t('invoice.payments')}</h3>
          <ul>
            {inv.payments.map((p, i) => (
              <li key={i}>
                {t('invoice.paymentLine', {
                  amount: price(p.amount),
                  method: t(`payMethod.${p.method}` as AdminKey),
                  date: formatDay(lang, p.paidOn),
                })}
                {p.reference ? ` · ${p.reference}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      {inv.status === 'void' && inv.voidReason && (
        <p className="font-medium">{t('invoice.voided', { reason: inv.voidReason })}</p>
      )}
    </article>
  );
}
