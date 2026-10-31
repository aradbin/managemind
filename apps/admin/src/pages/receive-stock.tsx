// Inventory → Receive stock (phase-8-plan §3.3, §3.7, §3.12): one screen for
// receiving an ordered PO and for a market purchase without one. Staff
// without the cost permission enter quantities only, at the PO's costs.
// Pay now records a payment for all or part of it in the same step.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { readPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { idempotencyKey, type Localized, lineLabel } from '../lib/orders';
import {
  dhakaToday,
  type GoodsReceiptBody,
  PURCHASING_KEYS,
  type PurchaseOrder,
  priceOrDash,
  purchaseOrderQuery,
  readCount,
  SPEND_METHODS,
  type SpendMethod,
  suppliersQuery,
} from '../lib/purchasing';

export interface ReceiveSearch {
  purchaseOrderId?: string | undefined;
}

export function ReceiveStockPage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as ReceiveSearch;
  const order = useQuery({
    ...purchaseOrderQuery(search.purchaseOrderId ?? ''),
    enabled: Boolean(search.purchaseOrderId),
  });
  if (search.purchaseOrderId && order.isPending) return <p role="status">{t('loading')}</p>;
  if (order.isError) return <Notice tone="error">{errorMessage(order.error, t)}</Notice>;
  return <ReceiveForm key={order.data?.updatedAt ?? 'direct'} order={order.data} />;
}

interface Line {
  variantId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  quantity: string;
  unitCost: string;
  remaining: number | null;
}

function ReceiveForm({ order }: { order?: PurchaseOrder | undefined }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seesCost = usePermission('catalog.cost');
  const canPay = usePermission('purchasing.pay');
  const canDirect = usePermission('purchasing.write');
  const suppliers = useQuery({ ...suppliersQuery(), enabled: !order && canDirect });
  const [supplierId, setSupplierId] = useState('');
  const [receivedOn, setReceivedOn] = useState(dhakaToday());
  const [invoice, setInvoice] = useState('');
  const [lines, setLines] = useState<Line[]>(
    order?.lines
      .filter((l) => l.remaining > 0)
      .map((l) => ({
        variantId: l.variantId,
        title: l.title,
        optionLabels: l.optionLabels,
        sku: l.sku,
        quantity: String(l.remaining),
        unitCost: '',
        remaining: l.remaining,
      })) ?? [],
  );
  const [cost, setCost] = useState({ label: '', amount: '' });
  const [pay, setPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [method, setMethod] = useState<SpendMethod>('cash');
  const [key] = useState(idempotencyKey);

  const parsed = lines.map((l) => ({
    quantity: readCount(l.quantity),
    unitCost: l.unitCost.trim() ? readPrice(l.unitCost) : null,
  }));
  const ownCost = cost.amount.trim() ? readPrice(cost.amount) : null;
  const paid = readPrice(payAmount);
  const hasSupplier = Boolean(order || supplierId);
  const valid =
    parsed.some((p) => p.quantity > 0) &&
    parsed.every(
      (p) =>
        (p.quantity === 0 || (Number.isInteger(p.quantity) && p.quantity > 0)) &&
        p.unitCost !== undefined &&
        (order || p.unitCost !== null || p.quantity === 0),
    ) &&
    ownCost !== undefined &&
    (!pay || (hasSupplier && typeof paid === 'number' && paid > 0));
  const preview = parsed.reduce(
    (a, p, i) =>
      a +
      (Number.isInteger(p.quantity) ? p.quantity : 0) *
        (typeof p.unitCost === 'number'
          ? p.unitCost
          : (order?.lines.find((l) => l.variantId === lines[i]?.variantId)?.unitCost ?? 0)),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const body: GoodsReceiptBody = {
        ...(order ? { purchaseOrderId: order.id } : supplierId ? { supplierId } : {}),
        receivedOn,
        supplierInvoice: invoice.trim() || null,
        lines: lines.flatMap((l, i) => {
          const p = parsed[i];
          if (!p || p.quantity <= 0) return [];
          return [
            {
              variantId: l.variantId,
              quantity: p.quantity,
              ...(typeof p.unitCost === 'number' ? { unitCost: p.unitCost } : {}),
            },
          ];
        }),
        otherCosts:
          typeof ownCost === 'number' && ownCost > 0
            ? [{ label: cost.label.trim() || t('po.otherCosts'), amount: ownCost }]
            : [],
        ...(pay && typeof paid === 'number' ? { payment: { amount: paid, method } } : {}),
      };
      return unwrap(
        await api.POST('/v1/admin/goods-receipts', {
          params: { header: { 'idempotency-key': key } },
          body,
        }),
      );
    },
    onSuccess: async (receipt) => {
      for (const k of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: k });
      toast(t('receive.saved', { reference: receipt.reference }));
      for (const w of receipt.warnings) {
        const line = receipt.lines.find((l) => l.variantId === w.variantId);
        toast(
          t('receive.overReceived', {
            extra: w.extra,
            item: line ? lineLabel(line, locale) : '',
          }),
        );
      }
      if (order) navigate({ to: '/inventory/purchase-orders/$id', params: { id: order.id } });
      else navigate({ to: '/inventory' });
    },
  });

  const editingCosts = seesCost && (canDirect || !order);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <PageHeader title={t('receive.title')} description={t('receive.intro')} />
      </div>
      {order ? (
        <p className="font-medium">
          {t('receive.forPo', { reference: order.reference, supplier: order.supplier.name })} ·{' '}
          <Link
            to="/inventory/purchase-orders/$id"
            params={{ id: order.id }}
            className="text-primary hover:underline"
          >
            {order.reference}
          </Link>
        </p>
      ) : (
        !canDirect && (
          <Notice tone="info">
            <Link to="/inventory/purchase-orders" className="text-primary hover:underline">
              {t('po.title')}
            </Link>
          </Notice>
        )
      )}
      {(order || canDirect) && (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <section className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
            {!order && (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('receive.supplier')}
                <select
                  className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">{t('receive.noSupplier')}</option>
                  {suppliers.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field
              label={t('receive.date')}
              type="date"
              value={receivedOn}
              max={dhakaToday()}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
            <Field
              label={`${t('receive.invoice')} (${t('form.optional')})`}
              value={invoice}
              maxLength={100}
              onChange={(e) => setInvoice(e.target.value)}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('po.lines')}</h2>
            {order && !seesCost && (
              <p className="text-sm text-muted-foreground">{t('receive.costHidden')}</p>
            )}
            {lines.length === 0 && <p className="text-muted-foreground">{t('receive.noItems')}</p>}
            {lines.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
                {lines.map((l, i) => {
                  const label = lineLabel(l, locale);
                  const p = parsed[i];
                  const poCost = order?.lines.find((x) => x.variantId === l.variantId)?.unitCost;
                  return (
                    <li
                      key={l.variantId}
                      className="flex flex-col gap-3 p-4 md:flex-row md:items-end"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{label}</span>
                        <span className="text-sm text-muted-foreground">
                          {[l.sku, l.remaining !== null && `${t('po.remaining')}: ${l.remaining}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="w-24">
                          <Field
                            label={t('receive.quantity')}
                            inputMode="numeric"
                            value={l.quantity}
                            aria-invalid={Number.isNaN(p?.quantity) ? true : undefined}
                            onChange={(e) =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, quantity: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </div>
                        {editingCosts && (
                          <div className="w-32">
                            <Field
                              label={t('po.unitCost')}
                              inputMode="decimal"
                              value={l.unitCost}
                              placeholder={poCost !== undefined ? priceOrDash(poCost, locale) : ''}
                              aria-invalid={p?.unitCost === undefined ? true : undefined}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, j) =>
                                    j === i ? { ...x, unitCost: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                        )}
                        {!order && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('po.remove', { item: label })}
                            onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          >
                            <Trash2 aria-hidden className="size-5" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!order && (
              <VariantPicker
                anyStock
                onPick={(row) => {
                  if (lines.some((l) => l.variantId === row.variantId)) return;
                  setLines([
                    ...lines,
                    {
                      variantId: row.variantId,
                      title: row.titles,
                      optionLabels: row.optionLabels,
                      sku: row.sku,
                      quantity: '1',
                      unitCost: '',
                      remaining: null,
                    },
                  ]);
                }}
              />
            )}
          </section>

          {editingCosts && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('po.otherCosts')}</h2>
              <p className="text-sm text-muted-foreground">{t('po.otherCostsHint')}</p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={t('po.costLabel')}
                    value={cost.label}
                    maxLength={100}
                    onChange={(e) => setCost({ ...cost, label: e.target.value })}
                  />
                </div>
                <div className="w-32">
                  <Field
                    label={t('payment.amount')}
                    inputMode="decimal"
                    value={cost.amount}
                    aria-invalid={ownCost === undefined ? true : undefined}
                    onChange={(e) => setCost({ ...cost, amount: e.target.value })}
                  />
                </div>
              </div>
              <p className="ml-auto font-semibold tabular-nums">
                {t('po.total')}:{' '}
                {priceOrDash(preview + (typeof ownCost === 'number' ? ownCost : 0), locale)}
              </p>
            </section>
          )}

          {canPay && hasSupplier && (
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
              <label className="flex min-h-11 items-center gap-3 font-medium">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={pay}
                  onChange={(e) => setPay(e.target.checked)}
                />
                {t('receive.payNow')}
              </label>
              {pay && (
                <>
                  <Field
                    label={t('receive.payAmount')}
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium">{t('payment.method')}</legend>
                    <div className="flex flex-wrap gap-x-4">
                      {SPEND_METHODS.map((m) => (
                        <label key={m} className="flex min-h-11 items-center gap-2">
                          <input
                            type="radio"
                            name="method"
                            className="size-5"
                            checked={method === m}
                            onChange={() => setMethod(m)}
                          />
                          {t(`purchasing.method.${m}`)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
            </section>
          )}

          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || save.isPending}>
              {t('receive.save')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
