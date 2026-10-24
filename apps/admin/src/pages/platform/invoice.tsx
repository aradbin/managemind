// One of our invoices on Platform → Billing (phase-5b-plan §3.7): the
// invoice as the store sees it, and for super admins issuing a draft,
// voiding, and recording a bank, bKash, Nagad or cash payment.
import { zodResolver } from '@hookform/resolvers/zod';
import { dhakaDate } from '@managemind/shared/billing';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Field } from '../../components/field';
import { Form, SelectField, TextField } from '../../components/form';
import { InvoiceDocument } from '../../components/invoice-document';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { useLocale } from '../../i18n';
import '../../i18n/billing';
import { formatDateTime } from '@managemind/shared/i18n';
import { api, meQuery, unwrap } from '../../lib/api';
import { formatPrice, priceInput, readPrice } from '../../lib/catalog';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

const METHODS = ['bank', 'bkash', 'nagad', 'cash'] as const;

export function PlatformInvoicePage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const superAdmin = me.user.platformRole === 'super_admin';
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState(false);
  const key = ['platform', 'invoice', id] as const;
  const invoice = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET('/v1/platform/invoices/{id}', { params: { path: { id } } })),
  });
  const refresh = async (message: string) => {
    toast(message);
    await queryClient.invalidateQueries({ queryKey: ['platform', 'invoices'] });
    await queryClient.invalidateQueries({ queryKey: key });
  };
  const issue = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/platform/invoices/{id}/issue', { params: { path: { id } } })),
    onSuccess: (issued) => refresh(t('pbilling.issued', { number: issued.number ?? '' })),
  });
  const voidIt = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/platform/invoices/{id}/void', {
          params: { path: { id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: async () => {
      setVoiding(false);
      setReason('');
      await refresh(t('pbilling.voidedToast'));
    },
  });
  const inv = invoice.data;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          to="/platform/billing"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          {t('pbilling.back')}
        </Link>
      </div>
      <PageHeader
        title={inv?.number ? t('invoice.title', { number: inv.number }) : t('invoice.draftTitle')}
      />
      {invoice.isPending && <p role="status">{t('loading')}</p>}
      {invoice.isError && <Notice tone="error">{errorMessage(invoice.error, t)}</Notice>}
      {inv && (
        <>
          <p>
            <Link
              to="/platform/tenants/$id"
              params={{ id: inv.tenantId }}
              className="text-primary underline-offset-2 hover:underline"
            >
              {inv.storeName}
            </Link>
          </p>
          {inv.status === 'draft' && inv.issueAfter && (
            <Notice>
              {t('pbilling.issueAfter', {
                date: formatDateTime(locale, new Date(inv.issueAfter), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </Notice>
          )}
          {superAdmin && (inv.status === 'draft' || inv.status === 'issued') && (
            <div className="flex flex-wrap gap-2">
              {inv.status === 'draft' && (
                <Button disabled={issue.isPending} onClick={() => issue.mutate()}>
                  {t('pbilling.issue')}
                </Button>
              )}
              {inv.status === 'issued' && (
                <Button onClick={() => setPaying(true)}>{t('pbilling.record')}</Button>
              )}
              {inv.amountPaid === 0 && (
                <Button variant="secondary" onClick={() => setVoiding(true)}>
                  {t('pbilling.void')}
                </Button>
              )}
            </div>
          )}
          {issue.isError && <Notice tone="error">{errorMessage(issue.error, t)}</Notice>}
          <div className="rounded-xl border border-border bg-background p-4 md:p-5">
            <InvoiceDocument invoice={inv} lang={locale} />
          </div>
          <ConfirmDialog
            open={voiding}
            onOpenChange={setVoiding}
            title={t('pbilling.voidTitle')}
            confirmLabel={t('pbilling.void')}
            canConfirm={reason.trim().length >= 3}
            busy={voidIt.isPending}
            error={voidIt.isError ? errorMessage(voidIt.error, t) : undefined}
            onConfirm={() => voidIt.mutate()}
          >
            <p>{t('pbilling.voidBody')}</p>
            <Field
              label={t('pbilling.voidReason')}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </ConfirmDialog>
          {inv.status === 'issued' && (
            <PaymentDialog
              open={paying}
              onOpenChange={setPaying}
              id={id}
              due={inv.amountDue}
              onDone={() => refresh(t('pbilling.recorded'))}
            />
          )}
        </>
      )}
    </div>
  );
}

const paymentSchema = z.object({
  amount: z.string().refine((v) => (readPrice(v) ?? 0) > 0, 'form.invalid'),
  method: z.enum(METHODS),
  reference: z.string().trim().max(100),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'form.required'),
});

function PaymentDialog({
  open,
  onOpenChange,
  id,
  due,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  due: number;
  onDone: () => Promise<void>;
}) {
  const { t, locale } = useLocale();
  const form = useForm<z.input<typeof paymentSchema>, unknown, z.output<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    values: {
      amount: priceInput(due),
      method: 'bank',
      reference: '',
      paidOn: dhakaDate(new Date()),
    },
  });
  const record = useMutation({
    mutationFn: async (v: z.output<typeof paymentSchema>) =>
      unwrap(
        await api.POST('/v1/platform/invoices/{id}/payments', {
          params: { path: { id } },
          body: {
            amount: readPrice(v.amount) ?? 0,
            method: v.method,
            paidOn: v.paidOn,
            ...(v.reference ? { reference: v.reference } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      onOpenChange(false);
      await onDone();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('pbilling.record')}>
      <Form form={form} onSubmit={(v) => record.mutate(v)}>
        <TextField
          name="amount"
          label={t('pbilling.amount')}
          hint={t('pbilling.amountHint', { due: formatPrice(due, locale) })}
          inputMode="decimal"
        />
        <SelectField
          name="method"
          label={t('pbilling.method')}
          options={METHODS.map((m) => ({ value: m, label: t(`payMethod.${m}`) }))}
        />
        <TextField
          name="reference"
          label={t('pbilling.reference')}
          hint={t('pbilling.referenceHint')}
          maxLength={100}
          optional
        />
        <TextField name="paidOn" label={t('pbilling.paidOn')} type="date" />
        {record.isError && <Notice tone="error">{saveErrorMessage(record.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={record.isPending}>
            {t('pbilling.record')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
