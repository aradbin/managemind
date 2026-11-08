// Inventory → Receive stock (phase-8-plan §3.3, §3.7, §3.12): one screen for
// receiving an ordered PO and for a market purchase without one. Staff
// without the cost permission enter quantities only, at the PO's costs.
// Pay now records a payment for all or part of it in the same step.
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ButtonChoices, MoneyInput } from '../components/ui/choice';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Segmented } from '../components/ui/segmented';
import { Switch } from '../components/ui/switch';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { DatePicker } from '../components/ui/date-picker';
import { api, unwrap } from '../lib/api';
import { priceInput, readPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, idempotencyKey, type Localized, lineLabel, pickText } from '../lib/orders';
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
import { cn } from '../lib/utils';

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
  const [mode, setMode] = useState<'po' | 'direct'>('po');
  const openOrders = useQuery({
    queryKey: ['purchase-orders', { status: 'to_receive' }] as const,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/purchase-orders', {
          params: { query: { status: 'to_receive' } },
        }),
      ),
    enabled: !order && mode === 'po',
  });
  const units = parsed.reduce((n, p) => n + (Number.isInteger(p.quantity) ? p.quantity : 0), 0);
  const total = preview + (typeof ownCost === 'number' ? ownCost : 0);
  const affix =
    'pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground';
  const grid =
    'grid grid-cols-[minmax(0,1fr)_80px_110px] items-center gap-x-2 md:grid-cols-[minmax(0,1fr)_80px_110px_32px]';
  const formId = 'receive-form';
  const received = order ? order.lines.reduce((n, l) => n + (l.quantity - l.remaining), 0) : 0;
  const orderedUnits = order ? order.lines.reduce((n, l) => n + l.quantity, 0) : 0;
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pb-28 md:gap-4 md:pb-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{t('receive.title')}</h1>
        <p className="text-muted-foreground">{t('receive.intro')}</p>
      </div>
      {!order && !canDirect ? (
        <Notice>
          <Link to="/inventory/purchase-orders" className="underline underline-offset-2">
            {t('po.title')}
          </Link>
        </Notice>
      ) : (
        <form
          id={formId}
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <section aria-label={t('receive.source')} className={cardPadded}>
            {canDirect && (
              <Segmented
                label={t('receive.source')}
                value={order ? 'po' : mode}
                options={[
                  { value: 'po', label: t('receive.fromPo') },
                  { value: 'direct', label: t('receive.withoutPo') },
                ]}
                className="w-full [&>button]:flex-1"
                onChange={(next) => {
                  if (order && next === 'direct') {
                    navigate({ to: '/inventory/receive', search: {} });
                    setMode('direct');
                  } else setMode(next);
                }}
              />
            )}
            {(order || mode === 'po') && (
              <div className="flex flex-col">
                <label htmlFor="receive-po" className={fieldLabel}>
                  {t('receive.purchaseOrder')}
                </label>
                <Combobox
                  id="receive-po"
                  searchLabel={t('receive.findPo')}
                  placeholder={t('receive.choosePo')}
                  value={order?.id ?? ''}
                  options={[
                    ...(order
                      ? [
                          {
                            value: order.id,
                            label: `${order.reference} · ${order.supplier.name}`,
                          },
                        ]
                      : []),
                    ...(openOrders.data?.items ?? [])
                      .filter((o) => o.id !== order?.id)
                      .map((o) => ({ value: o.id, label: `${o.reference} · ${o.supplier.name}` })),
                  ]}
                  onChange={(id) =>
                    navigate({ to: '/inventory/receive', search: { purchaseOrderId: id } })
                  }
                />
                {order && (
                  <p className={fieldHint}>
                    {t('po.progress', { received, ordered: orderedUnits })}
                    {order.expectedOn &&
                      ` · ${t('receive.expected', { date: dateOnly(locale, order.expectedOn) })}`}
                    {' · '}
                    <Link
                      to="/inventory/purchase-orders/$id"
                      params={{ id: order.id }}
                      className="underline underline-offset-2"
                    >
                      {t('receive.openPo', { reference: order.reference })}
                    </Link>
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {!order && mode === 'direct' && (
                <div className="flex flex-col md:col-span-2">
                  <label htmlFor="receive-supplier" className={fieldLabel}>
                    {t('receive.supplier')}
                  </label>
                  <Combobox
                    id="receive-supplier"
                    searchLabel={t('po.findSupplier')}
                    value={supplierId}
                    options={[
                      { value: '', label: t('receive.noSupplier') },
                      ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                    ]}
                    onChange={setSupplierId}
                  />
                </div>
              )}
              <div className="flex flex-col">
                <label htmlFor="receive-date" className={fieldLabel}>
                  {t('receive.date')}
                </label>
                <div className="flex gap-2">
                  <DatePicker
                    id="receive-date"
                    value={receivedOn}
                    max={dhakaToday()}
                    onChange={setReceivedOn}
                  />
                  <Button
                    variant={receivedOn === dhakaToday() ? 'primary' : 'secondary'}
                    onClick={() => setReceivedOn(dhakaToday())}
                  >
                    {t('receive.today')}
                  </Button>
                </div>
              </div>
              <Field
                label={t('receive.invoice')}
                optional
                value={invoice}
                maxLength={100}
                onChange={(e) => setInvoice(e.target.value)}
              />
            </div>
          </section>

          <section aria-labelledby="receive-items" className={cardPadded}>
            <div className="flex flex-col gap-1">
              <h2 id="receive-items" className={cardTitle}>
                {t('po.lines')}
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {order
                  ? seesCost
                    ? t('receive.costHint')
                    : t('receive.costHidden')
                  : t('receive.noItems')}
              </p>
            </div>
            {lines.length > 0 && (
              <div className="overflow-hidden rounded-[10px] border border-border">
                <div
                  aria-hidden
                  className={cn(grid, 'h-9 bg-muted pr-2 pl-4 text-[13px] font-medium')}
                >
                  <span>{t('po.item')}</span>
                  <span className="text-right">{t('receive.quantity')}</span>
                  <span className="text-right">{editingCosts ? t('po.unitCost') : ''}</span>
                  <span className="max-md:hidden" />
                </div>
                <ul aria-label={t('po.lines')}>
                  {lines.map((l, i) => {
                    const p = parsed[i];
                    const poCost = order?.lines.find((x) => x.variantId === l.variantId)?.unitCost;
                    const options = l.optionLabels
                      .map((o) => pickText(o, locale))
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <li
                        key={l.variantId}
                        className={cn(grid, 'min-h-12 border-t border-border py-1.5 pr-2 pl-4')}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span id={`receive-line-${i}`} className="truncate">
                            <span className="font-medium">{pickText(l.title, locale)}</span>
                            {options && <span className="text-muted-foreground"> · {options}</span>}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[
                              l.sku,
                              l.remaining !== null &&
                                t('receive.toCome', { count: formatNumber(locale, l.remaining) }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <Input
                          inputMode="numeric"
                          aria-label={t('receive.quantity')}
                          aria-describedby={`receive-line-${i}`}
                          className="h-8 text-right tabular-nums md:h-8"
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
                        {editingCosts ? (
                          <span className="relative block">
                            <span aria-hidden className={affix}>
                              ৳
                            </span>
                            <Input
                              inputMode="decimal"
                              aria-label={t('po.unitCost')}
                              aria-describedby={`receive-line-${i}`}
                              className="h-8 pl-6 text-right tabular-nums md:h-8"
                              value={l.unitCost}
                              placeholder={poCost !== undefined ? priceInput(poCost) : ''}
                              aria-invalid={p?.unitCost === undefined ? true : undefined}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, j) =>
                                    j === i ? { ...x, unitCost: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="flex justify-end max-md:hidden">
                          {!order && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 md:size-8"
                              aria-label={t('po.remove', { item: lineLabel(l, locale) })}
                              onClick={() => setLines(lines.filter((_, j) => j !== i))}
                            >
                              <X aria-hidden className="size-4" />
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
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
            <section aria-labelledby="receive-costs" className={cardPadded}>
              <div className="flex flex-col gap-1">
                <h2 id="receive-costs" className={cardTitle}>
                  {t('po.otherCosts')}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({t('form.optional')})
                  </span>
                </h2>
                <p className="text-[13px] text-muted-foreground">{t('po.otherCostsHint')}</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                <Input
                  aria-label={t('po.costLabel')}
                  placeholder={t('po.costLabel')}
                  value={cost.label}
                  maxLength={100}
                  onChange={(e) => setCost({ ...cost, label: e.target.value })}
                />
                <span className="relative block">
                  <span aria-hidden className={affix}>
                    ৳
                  </span>
                  <Input
                    inputMode="decimal"
                    aria-label={t('payment.amount')}
                    placeholder="0"
                    className="pl-6 text-right tabular-nums"
                    value={cost.amount}
                    aria-invalid={ownCost === undefined ? true : undefined}
                    onChange={(e) => setCost({ ...cost, amount: e.target.value })}
                  />
                </span>
              </div>
            </section>
          )}

          {canPay && hasSupplier && (
            <section className={cardPadded}>
              <div className="flex min-h-10 items-center justify-between gap-4">
                <label htmlFor="receive-pay" className="cursor-pointer font-medium">
                  {t('receive.payNow')}
                </label>
                <Switch id="receive-pay" checked={pay} onCheckedChange={setPay} />
              </div>
              {pay && (
                <>
                  <div className="flex flex-col md:max-w-[calc(50%-8px)]">
                    <label htmlFor="receive-paid" className={fieldLabel}>
                      {t('receive.payAmount')}
                    </label>
                    <MoneyInput
                      id="receive-paid"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span id="receive-method" className={fieldLabel}>
                      {t('payment.method')}
                    </span>
                    <ButtonChoices
                      name="method"
                      labelId="receive-method"
                      value={method}
                      options={SPEND_METHODS.map((m) => ({
                        value: m,
                        label: t(`purchasing.method.${m}`),
                      }))}
                      onChange={setMethod}
                    />
                  </div>
                </>
              )}
            </section>
          )}
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </form>
      )}
      {(order || canDirect) && (
        <SaveBar
          show={lines.length > 0}
          message={t('receive.barSummary', {
            units: formatNumber(locale, units),
            total: priceOrDash(total, locale),
          })}
          discardLabel={t('receive.clear')}
          onDiscard={() => setLines(lines.map((l) => ({ ...l, quantity: '0', unitCost: '' })))}
          saveLabel={t('receive.save')}
          busy={save.isPending}
          saveDisabled={!valid}
          form={formId}
        />
      )}
    </div>
  );
}
