// Settings → Plan and billing (phase-5b-plan §3.7, §7), for owners and
// managers: the plan, this period's use against its limits, our invoices to
// view, print and pay, and how to pay. SSLCommerz brings the payer back with
// ?invoice=, which opens that invoice.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { fieldLabel } from '../components/field-styles';
import { InvoiceDocument, statusLabel } from '../components/invoice-document';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/billing';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { billingQuery, formatDay, storeInvoiceQuery } from '../lib/billing';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

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
  const planTone = (status: string) =>
    status === 'active'
      ? ('good' as const)
      : status === 'trialing'
        ? ('progress' as const)
        : status === 'past_due'
          ? ('bad' as const)
          : ('outline' as const);
  const invoiceTone = (i: { status: string; overdue: boolean }) =>
    i.overdue
      ? ('bad' as const)
      : i.status === 'paid'
        ? ('good' as const)
        : i.status === 'issued'
          ? ('waiting' as const)
          : ('outline' as const);
  const viewing = b?.invoices.find((i) => i.id === search.invoice);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('billing.title')}
        description={`${t('billing.description')}.`}
      />
      {billing.isPending && <p role="status">{t('loading')}</p>}
      {billing.isError && <Notice tone="error">{errorMessage(billing.error, t)}</Notice>}
      {b && (
        <>
          <section aria-labelledby="plan-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
            <h2 id="plan-h" className={cardTitle}>
              {t('billing.plan')}
            </h2>
            {b.plan ? (
              <div className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{b.plan.name[locale]}</span>
                  <StatusBadge tone={planTone(b.plan.status)}>
                    {t(`subscription.status.${b.plan.status}` as AdminKey)}
                  </StatusBadge>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {[
                    t('billing.monthly', { price: formatPrice(b.plan.monthlyPrice, locale) }),
                    b.plan.trialEndsOn &&
                      t('billing.trialUntil', { date: formatDay(locale, b.plan.trialEndsOn) }),
                    t('billing.billingDay', { day: b.plan.billingDay }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground">{t('billing.noPlan')}</p>
            )}
          </section>

          <section aria-labelledby="usage-h" className={cn(cardPadded, 'gap-4 md:gap-4')}>
            <div className="flex flex-col gap-1">
              <h2 id="usage-h" className={cardTitle}>
                {t('billing.usage')}
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {t('billing.period', {
                  start: formatDay(locale, b.period.start),
                  end: formatDay(locale, b.period.end),
                })}
              </p>
            </div>
            <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {b.meters.map((m) => (
                <li key={m.name} className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap justify-between gap-2 text-[13px] tabular-nums">
                    <span>{t(`meter.${m.name}` as AdminKey)}</span>
                    <span className="font-medium">{meterText(m, t)}</span>
                  </span>
                  {m.limit !== null && (
                    <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          m.level === 'over'
                            ? 'bg-danger'
                            : m.level === 'warn'
                              ? 'bg-[var(--tone-warn)]'
                              : 'bg-primary',
                        )}
                        style={{
                          width: `${m.limit === 0 ? 100 : Math.min(100, (m.used / m.limit) * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                  {m.level !== 'ok' && (
                    <span
                      className={cn(
                        'text-xs font-medium',
                        m.level === 'over' ? 'text-danger' : 'text-warning-foreground',
                      )}
                    >
                      {t(m.level === 'over' ? 'billing.meterOver' : 'billing.meterWarn')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="invoices-h" className={cn(cardPadded, 'gap-2 md:gap-2')}>
            <h2 id="invoices-h" className={cardTitle}>
              {t('billing.invoices')}
            </h2>
            {b.invoices.length === 0 ? (
              <p className="text-muted-foreground">{t('billing.noInvoices')}</p>
            ) : (
              <ul className="-mx-4 md:-mx-5">
                {b.invoices.map((i) => (
                  <li
                    key={i.id}
                    className="flex min-h-14 items-center gap-3 border-t border-border py-1.5 pr-3 pl-4 md:pl-5"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-mono font-medium">{i.number}</span>
                      {i.dueOn && (
                        <span className="truncate text-[13px] text-muted-foreground">
                          {t('billing.dueOn', { date: formatDay(locale, i.dueOn) })}
                        </span>
                      )}
                    </span>
                    <StatusBadge tone={invoiceTone(i)}>{statusLabel(locale, i)}</StatusBadge>
                    <span className="w-[72px] text-right font-medium tabular-nums">
                      {formatPrice(i.total, locale)}
                    </span>
                    <Button
                      variant="ghost"
                      aria-haspopup="dialog"
                      aria-label={t('invoice.title', { number: i.number ?? '' })}
                      onClick={() => open(i.id)}
                    >
                      {t('invoice.view')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {search.invoice && (
            <Dialog
              open
              onOpenChange={(next) => !next && open(undefined)}
              title={
                viewing?.number ? t('invoice.title', { number: viewing.number }) : t('invoice.view')
              }
              className="md:max-w-2xl"
            >
              <InvoicePanel
                id={search.invoice}
                payOnline={b.payOnline}
                onClose={() => open(undefined)}
              />
            </Dialog>
          )}

          <section aria-labelledby="pay-h" className={cn(cardPadded, 'gap-4 md:gap-4')}>
            <div className="flex flex-col gap-1">
              <h2 id="pay-h" className={cardTitle}>
                {t('billing.howToPay')}
              </h2>
              {b.payTo && (
                <p className="text-[13px] text-muted-foreground">{t('billing.payIntro')}</p>
              )}
            </div>
            {b.payTo ? (
              <ul className="grid gap-3 md:grid-cols-3">
                {b.payTo.bank && (
                  <li className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-3">
                    <span className={fieldLabel}>{t('billing.bank')}</span>
                    <span className="text-[13px] whitespace-pre-line">
                      {[
                        b.payTo.bank.accountName,
                        [b.payTo.bank.name, b.payTo.bank.branch].filter(Boolean).join(', '),
                        b.payTo.bank.accountNumber && `A/C ${b.payTo.bank.accountNumber}`,
                        b.payTo.bank.routing,
                      ]
                        .filter(Boolean)
                        .join('\n')}
                    </span>
                  </li>
                )}
                {b.payTo.bkash && (
                  <li className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-3">
                    <span className={fieldLabel}>{t('billing.bkash')}</span>
                    <span className="text-[13px]">{b.payTo.bkash}</span>
                  </li>
                )}
                {b.payTo.nagad && (
                  <li className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-3">
                    <span className={fieldLabel}>{t('billing.nagad')}</span>
                    <span className="text-[13px]">{b.payTo.nagad}</span>
                  </li>
                )}
              </ul>
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
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
