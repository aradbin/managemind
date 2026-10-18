// Editing an order before anything ships (phase-4-plan §3.9, §7): change
// quantities, remove or add lines, and see the new totals, the promotions
// that no longer apply and any refund due before saving.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import {
  idempotencyKey,
  lineLabel,
  type OrderDetail,
  orderErrorMessage,
  pickText,
  withKey,
} from '../lib/orders';

interface Draft {
  variantId: string;
  label: string;
  quantity: string;
}

export function EditOrderDialog({
  order: o,
  onClose,
}: {
  order: OrderDetail;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [key] = useState(idempotencyKey);
  const [lines, setLines] = useState<Draft[]>(() =>
    o.lines.map((l) => ({
      variantId: l.variantId,
      label: lineLabel(l, locale),
      quantity: String(l.quantity),
    })),
  );
  const [reason, setReason] = useState('');
  const parsed = lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity) }));
  const valid =
    parsed.length > 0 && parsed.every((l) => Number.isInteger(l.quantity) && l.quantity >= 1);
  const body = { lines: parsed, ...(reason.trim() ? { reason: reason.trim() } : {}) };
  const preview = useQuery({
    queryKey: ['order-edit-preview', o.id, parsed] as const,
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/edit/preview', {
          params: { path: { id: o.id } },
          body: { lines: parsed },
        }),
      ),
    enabled: valid,
    retry: false,
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/edit', {
          params: { path: { id: o.id }, ...withKey(key).params },
          body,
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['order', o.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast(t('order.edited'));
      onClose();
    },
  });

  const set = (i: number, patch: Partial<Draft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const q = preview.data?.quote;
  const problems = q?.lines.filter((l) => l.problem) ?? [];
  const money = (n: number) => formatPrice(n, locale);

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t('order.editTitle', { number: o.displayNumber })}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !problems.length) save.mutate();
        }}
      >
        <ul className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={l.variantId} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{l.label}</span>
              <Input
                className="w-20"
                inputMode="numeric"
                aria-label={t('order.quantityOf', { item: l.label })}
                value={l.quantity}
                onChange={(e) => set(i, { quantity: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('order.removeLine', { item: l.label })}
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <VariantPicker
          onPick={(row) =>
            setLines((prev) =>
              prev.some((l) => l.variantId === row.variantId)
                ? prev.map((l) =>
                    l.variantId === row.variantId
                      ? { ...l, quantity: String(Number(l.quantity) + 1) }
                      : l,
                  )
                : [
                    ...prev,
                    {
                      variantId: row.variantId,
                      label: lineLabel(
                        { title: row.titles, optionLabels: row.optionLabels },
                        locale,
                      ),
                      quantity: '1',
                    },
                  ],
            )
          }
        />
        <Field
          label={t('order.editReason')}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="rounded-md bg-muted p-3 text-sm" aria-live="polite">
          {!valid ? (
            t('order.shipmentInvalid')
          ) : preview.isPending ? (
            t('loading')
          ) : preview.isError ? (
            <span className="text-danger">{orderErrorMessage(preview.error, t)}</span>
          ) : q ? (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span>{t('order.newTotal')}</span>
                <span className="font-semibold">
                  {money(q.totals.total)}{' '}
                  <span className="font-normal text-muted-foreground">
                    ({t('order.was', { amount: money(o.totals.total) })})
                  </span>
                </span>
              </div>
              {preview.data.dropped.map((d) => (
                <p key={d.promotionId} className="text-danger">
                  {t('order.promotionDropped', { title: pickText(d.title, locale) })}
                </p>
              ))}
              {preview.data.refundDue > 0 && (
                <p className="font-medium text-danger">
                  {t('order.refundAfterEdit', { amount: money(preview.data.refundDue) })}
                </p>
              )}
              {problems.map((l) => (
                <p key={l.key} className="text-danger">
                  {t('order.lineProblem', { item: lineLabel(l, locale) })}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        {save.error && <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending || problems.length > 0}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
