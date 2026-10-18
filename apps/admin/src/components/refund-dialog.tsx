// A refund (phase-5a-plan §3.13): the computed amount with each line's share,
// then the method. Staff can lower the amount with a reason, never raise
// it; bKash, Nagad, Rocket, bank and panel refunds need their reference.
// The key is kept for the dialog's life, so a retry can't refund twice.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice, priceInput, readPrice } from '../lib/catalog';
import { idempotencyKey, orderErrorMessage, pickText, withKey } from '../lib/orders';
import { type RefundMethod, refundPreviewQuery } from '../lib/returns';
import { Field } from './field';
import { Notice } from './notice';
import { useToast } from './toast';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

const MANUAL: RefundMethod[] = ['bkash', 'nagad', 'rocket', 'bank', 'cash', 'store_credit'];
const NEEDS_REFERENCE: RefundMethod[] = ['bkash', 'nagad', 'rocket', 'bank', 'gateway_manual'];

export function RefundDialog({
  orderId,
  returnId,
  suggested,
  onClose,
}: {
  orderId: string;
  returnId: string | null;
  /** A lower amount to start from, such as what an exchange left over. */
  suggested?: number | undefined;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const preview = useQuery(refundPreviewQuery(orderId, returnId));
  const [key] = useState(idempotencyKey);
  const [method, setMethod] = useState<RefundMethod | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [reason, setReason] = useState(suggested !== undefined ? t('refund.exchangeReason') : '');
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);

  const p = preview.data;
  const gateway = p?.gatewayPayments.find((g) => g.left > 0) ?? null;
  const methods: RefundMethod[] = [
    ...(gateway ? (['gateway', 'gateway_manual'] as const) : []),
    ...MANUAL,
  ];
  const chosen = method ?? methods[0] ?? 'cash';
  const text = amountText ?? priceInput(suggested ?? p?.amount ?? 0);
  const amount = readPrice(text);
  const max = Math.min(
    p?.amount ?? 0,
    chosen.startsWith('gateway') ? (gateway?.left ?? 0) : Infinity,
  );
  const errors = {
    amount: amount === undefined || amount === null || amount < 1 || amount > max,
    reason: amount !== undefined && amount !== null && amount < (p?.amount ?? 0) && !reason.trim(),
    reference: NEEDS_REFERENCE.includes(chosen) && !reference.trim(),
  };

  const refund = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/refunds', {
          params: { path: { id: orderId }, ...withKey(key).params },
          body: {
            ...(returnId ? { returnId } : {}),
            method: chosen,
            ...(amount && amount !== p?.amount ? { amount } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            ...(chosen.startsWith('gateway') && gateway ? { paymentId: gateway.id } : {}),
          },
        }),
      ),
    onSuccess: async (done) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['return'] }),
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
      ]);
      toast(
        done.creditCode
          ? t('refund.creditIssued', { code: done.creditCode })
          : done.status === 'failed'
            ? t('refund.gatewayFailed')
            : done.status === 'succeeded'
              ? t('refund.done')
              : t('refund.processing'),
      );
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('refund.title')}>
      {preview.isPending && <p role="status">{t('loading')}</p>}
      {preview.isError && <Notice tone="error">{orderErrorMessage(preview.error, t)}</Notice>}
      {p && p.amount <= 0 && <Notice>{t('refund.nothing')}</Notice>}
      {p && p.amount > 0 && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (Object.values(errors).some(Boolean)) return;
            refund.mutate();
          }}
        >
          <dl className="flex flex-col gap-1 text-sm">
            {p.lines.map((l) => (
              <div key={l.orderLineId} className="flex justify-between gap-2">
                <dt>
                  {pickText(l.title, locale)} × {l.quantity}
                </dt>
                <dd>{formatPrice(l.amount, locale)}</dd>
              </div>
            ))}
            {p.delivery > 0 && (
              <div className="flex justify-between gap-2">
                <dt>{t('refund.delivery')}</dt>
                <dd>{formatPrice(p.delivery, locale)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2 border-t border-border pt-1 font-semibold">
              <dt>{t('refund.computed')}</dt>
              <dd>{formatPrice(p.amount, locale)}</dd>
            </div>
          </dl>
          <fieldset disabled={refund.isPending} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('refund.method')}</legend>
              {methods.map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="refund-method"
                    className="size-5"
                    checked={chosen === m}
                    onChange={() => setMethod(m)}
                  />
                  {t(`refund.method.${m}` as AdminKey)}
                </label>
              ))}
            </fieldset>
            <Field
              label={t('refund.amount')}
              hint={t('refund.amountHint', { max: formatPrice(max, locale) })}
              inputMode="decimal"
              value={text}
              onChange={(e) => setAmountText(e.target.value)}
              error={tried && errors.amount ? t('form.invalid') : undefined}
            />
            {amount !== undefined && amount !== null && amount < p.amount && (
              <Field
                label={t('refund.reason')}
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                error={tried && errors.reason ? t('form.required') : undefined}
              />
            )}
            {NEEDS_REFERENCE.includes(chosen) && (
              <Field
                label={t('refund.reference')}
                hint={t('refund.referenceHint')}
                value={reference}
                maxLength={100}
                onChange={(e) => setReference(e.target.value)}
                error={tried && errors.reference ? t('form.required') : undefined}
              />
            )}
          </fieldset>
          {refund.error && <Notice tone="error">{orderErrorMessage(refund.error, t)}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={refund.isPending}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={refund.isPending}>
              {t('refund.confirm', { amount: formatPrice(amount ?? 0, locale) })}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
