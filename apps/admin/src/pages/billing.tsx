// Settings → Plan and billing (phase-5b-plan §3.7, §7), for owners and
// managers: the plan, this period's use against its limits, our invoices to
// view, print and pay, and how to pay. SSLCommerz brings the payer back with
// ?invoice=, which opens that invoice.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { InvoiceDocument, statusLabel } from '../components/invoice-document';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/billing';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { billingQuery, formatDay, storeInvoiceQuery } from '../lib/billing';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';

type Billing = Awaited<ReturnType<typeof billingQuery.queryFn>>;
type Meter = Billing['meters'][number];

export function meterText(
  m: Meter,
  t: (key: AdminKey, p?: Record<string, string | number>) => string,
) {
  return m.limit === null
    ? t('billing.meterUnlimited', { used: m.used })
    : t('billing.meterOf', { used: m.used, limit: m.limit });
}

export function BillingPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as { invoice?: string };
  const navigate = useNavigate();
  const billing = useQuery(billingQuery);
  const open = (invoice: string | undefined) =>
    navigate({ to: '/settings/billing', search: invoice ? { invoice } : {}, replace: true });
  const b = billing.data;
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('billing.title')}
      />
      {billing.isPending && <p role="status">{t('loading')}</p>}
      {billing.isError && <Notice tone="error">{errorMessage(billing.error, t)}</Notice>}
      {b && (
        <>
          <section aria-labelledby="plan-h" className="flex flex-col gap-2">
            <h2 id="plan-h" className="text-lg font-semibold">
              {t('billing.plan')}
            </h2>
            {b.plan ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">{t('billing.plan')}</dt>
                <dd>
                  {b.plan.name[locale]} ·{' '}
                  {t('billing.monthly', { price: formatPrice(b.plan.monthlyPrice, locale) })}
                </dd>
                <dt className="text-muted-foreground">{t('subscription.status')}</dt>
                <dd>{t(`subscription.status.${b.plan.status}` as AdminKey)}</dd>
                {b.plan.trialEndsOn && (
                  <>
                    <dt className="sr-only">{t('newStore.trialEnds')}</dt>
                    <dd className="col-span-2">
                      {t('billing.trialUntil', { date: formatDay(locale, b.plan.trialEndsOn) })}
                    </dd>
                  </>
                )}
                <dt className="sr-only">{t('newStore.billingDay')}</dt>
                <dd className="col-span-2 text-muted-foreground">
                  {t('billing.billingDay', { day: b.plan.billingDay })}
                </dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">{t('billing.noPlan')}</p>
            )}
          </section>

          <section aria-labelledby="usage-h" className="flex flex-col gap-3">
            <h2 id="usage-h" className="text-lg font-semibold">
              {t('billing.usage')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('billing.period', {
                start: formatDay(locale, b.period.start),
                end: formatDay(locale, b.period.end),
              })}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2">
              {b.meters.map((m) => (
                <li key={m.name} className="flex flex-col gap-1">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span>{t(`meter.${m.name}` as AdminKey)}</span>
                    <span className={m.level === 'ok' ? '' : 'font-semibold text-danger'}>
                      {meterText(m, t)}
                    </span>
                  </span>
                  {m.limit !== null && (
                    <span aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className={`block h-full ${m.level === 'ok' ? 'bg-primary' : 'bg-danger'}`}
                        style={{
                          width: `${m.limit === 0 ? 100 : Math.min(100, (m.used / m.limit) * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                  {m.level !== 'ok' && (
                    <span className="text-sm text-danger">
                      {t(m.level === 'over' ? 'billing.meterOver' : 'billing.meterWarn')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="invoices-h" className="flex flex-col gap-3">
            <h2 id="invoices-h" className="text-lg font-semibold">
              {t('billing.invoices')}
            </h2>
            {b.invoices.length === 0 ? (
              <p className="text-muted-foreground">{t('billing.noInvoices')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {b.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                    <span className="flex flex-1 flex-col">
                      <span className="font-medium">{i.number}</span>
                      <span className="text-sm text-muted-foreground">
                        {i.dueOn && `${t('invoice.dueOn')}: ${formatDay(locale, i.dueOn)}`}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <span>{formatPrice(i.total, locale)}</span>
                      <span
                        className={`text-sm ${i.overdue ? 'font-semibold text-danger' : 'text-muted-foreground'}`}
                      >
                        {statusLabel(locale, i)}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      aria-pressed={search.invoice === i.id}
                      onClick={() => open(search.invoice === i.id ? undefined : i.id)}
                    >
                      {t('invoice.view')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {search.invoice && (
              <InvoicePanel
                id={search.invoice}
                payOnline={b.payOnline}
                onClose={() => open(undefined)}
              />
            )}
          </section>

          <section aria-labelledby="pay-h" className="flex flex-col gap-3">
            <h2 id="pay-h" className="text-lg font-semibold">
              {t('billing.howToPay')}
            </h2>
            {b.payTo ? (
              <>
                <p>{t('billing.payIntro')}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  {b.payTo.bank && (
                    <>
                      <dt className="text-muted-foreground">{t('billing.bank')}</dt>
                      <dd>
                        {[
                          b.payTo.bank.name,
                          b.payTo.bank.accountName,
                          b.payTo.bank.accountNumber,
                          b.payTo.bank.branch,
                          b.payTo.bank.routing,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </>
                  )}
                  {b.payTo.bkash && (
                    <>
                      <dt className="text-muted-foreground">{t('billing.bkash')}</dt>
                      <dd>{b.payTo.bkash}</dd>
                    </>
                  )}
                  {b.payTo.nagad && (
                    <>
                      <dt className="text-muted-foreground">{t('billing.nagad')}</dt>
                      <dd>{b.payTo.nagad}</dd>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground">{t('billing.payToMissing')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InvoicePanel({
  id,
  payOnline,
  onClose,
}: {
  id: string;
  payOnline: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const invoice = useQuery(storeInvoiceQuery(id));
  const pay = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/billing/invoices/{id}/pay', { params: { path: { id } } })),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const inv = invoice.data;
  return (
    <section
      aria-label={inv?.number ? t('invoice.title', { number: inv.number }) : t('invoice.view')}
      className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      {invoice.isPending && <p role="status">{t('loading')}</p>}
      {invoice.isError && <Notice tone="error">{errorMessage(invoice.error, t)}</Notice>}
      {inv && (
        <>
          {inv.status === 'issued' && <Notice>{t('billing.justPaid')}</Notice>}
          <InvoiceDocument invoice={inv} lang={locale} />
          {pay.isError && <Notice tone="error">{errorMessage(pay.error, t)}</Notice>}
          <div className="flex flex-wrap gap-2">
            {payOnline && inv.status === 'issued' && inv.amountDue > 0 && (
              <Button disabled={pay.isPending} onClick={() => pay.mutate()}>
                {t('invoice.payOnline', { amount: formatPrice(inv.amountDue, locale) })}
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link to="/print/invoice" search={{ id }} target="_blank" rel="noopener">
                <Printer aria-hidden className="size-4" />
                {t('invoice.print')}
              </Link>
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('invoice.close')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
